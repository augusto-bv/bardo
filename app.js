import 'dotenv/config';
import express from 'express';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { createClient } from '@supabase/supabase-js'
import { DiscordRequest } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient('https://yeaisalgrclmemvpibsx.supabase.co', 'sb_publishable_e-4-yNLGA1vrwISDP-gd9Q_zr-gAHeO')

const MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// ─── Cores ────────────────────────────────────────────────────────────────────
const COLOR = {
  SUCCESS: 0x57F287,
  ERROR:   0xED4245,
  WARNING: 0xFEE75C,
  INFO:    0x5865F2,
  DANGER:  0xFF6B35,
  DOWN:    0xFF0000,
  UP:      0x00CC66,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function unixTs(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function embedReply(embed, ephemeral = false) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : 0,
      embeds: [{ ...embed, timestamp: new Date().toISOString(), footer: { text: 'Bardo' } }],
    },
  };
}

// ─── Embeds de monitoramento ──────────────────────────────────────────────────
function embedDown(url, downedAt) {
  return {
    title: 'Site fora do ar',
    description: `**${url}** parou de responder.`,
    color: COLOR.DOWN,
    fields: [
      { name: 'Status',       value: '`Sem resposta`',              inline: true },
      { name: 'Detectado às', value: `<t:${unixTs(downedAt)}:T>`,   inline: true },
    ],
    timestamp: new Date(downedAt).toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

function embedUp(url, downedAt) {
  const now = new Date();
  const fields = [{ name: 'Status', value: '`Online`', inline: true }];
  if (downedAt) {
    fields.push({ name: 'Caiu às',    value: `<t:${unixTs(downedAt)}:T>`,             inline: true });
    fields.push({ name: 'Ficou fora', value: formatDuration(now - new Date(downedAt)), inline: true });
  }
  return {
    title: 'Site voltou ao ar',
    description: `**${url}** está respondendo normalmente.`,
    color: COLOR.UP,
    fields,
    timestamp: now.toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

function embedTest(url) {
  return {
    title: 'Notificação de teste',
    description: `Quando o site cair, você receberá uma mensagem como esta.\n\n**${url}**`,
    color: COLOR.INFO,
    fields: [{ name: 'Status', value: '`Monitorando...`', inline: true }],
    timestamp: new Date().toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

// ─── DM ───────────────────────────────────────────────────────────────────────
async function sendDM(userId, embed) {
  const dmRes = await DiscordRequest('users/@me/channels', { method: 'POST', body: { recipient_id: userId } });
  const { id: channelId } = await dmRes.json();
  await DiscordRequest(`channels/${channelId}/messages`, { method: 'POST', body: { embeds: [embed] } });
}

// ─── Loop de monitoramento ────────────────────────────────────────────────────
async function runMonitoringCycle() {
  const { data: sites, error } = await supabase.from('monitored_sites').select();
  if (error) { console.error('Erro ao buscar sites:', error); return; }

  for (const site of sites) {
    const down = await isSiteDown(site.url);

    if (down && !site.is_down) {
      const downedAt = new Date();
      await supabase.from('monitored_sites').update({ is_down: true, downed_at: downedAt.toISOString() }).eq('id', site.id);
      await supabase.from('site_monitor_logs').insert([{ site_id: site.id, user_id: site.user_id, url: site.url, event: 'down' }]);
      try { await sendDM(site.user_id, embedDown(site.url, downedAt)); }
      catch (err) { console.error(`Erro ao enviar DM (down) para ${site.user_id}:`, err); }

    } else if (!down && site.is_down) {
      const downedAt = site.downed_at ? new Date(site.downed_at) : null;
      await supabase.from('monitored_sites').update({ is_down: false, downed_at: null }).eq('id', site.id);
      await supabase.from('site_monitor_logs').insert([{ site_id: site.id, user_id: site.user_id, url: site.url, event: 'up' }]);
      try { await sendDM(site.user_id, embedUp(site.url, downedAt)); }
      catch (err) { console.error(`Erro ao enviar DM (up) para ${site.user_id}:`, err); }
    }
  }
}

// ─── isSiteDown ───────────────────────────────────────────────────────────────
async function isSiteDown(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return res.status >= 500;
  } catch {
    return true;
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.status(200).json({ status: 'alive' }));

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { type, data } = req.body;
  const userId = req.body.member?.user?.id ?? req.body.user?.id;

  // ── Comandos slash ───────────────────────────────────────────────────────────
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'drop-quote') {
      const newQuote = data.options[0].value;
      const { error } = await supabase.from('quotes').insert([{ quote: newQuote }]);
      if (error) {
        return res.send(embedReply({ title: '❌ Erro ao registrar', description: 'Não foi possível salvar a frase.', color: COLOR.ERROR }, true));
      }
      return res.send(embedReply({
        title: 'Frase registrada',
        description: `> *"${newQuote}"*`,
        color: COLOR.INFO,
      }, true));
    }

    if (name === 'expose-quotes') {
      const { data: quotes, error } = await supabase.from('quotes').select();
      if (error) return res.send(embedReply({ title: '❌ Erro ao buscar frases', color: COLOR.ERROR }));
      if (!quotes?.length) return res.send(embedReply({ title: 'Nenhuma frase registrada', description: 'Use `/drop-quote` para adicionar a primeira!', color: COLOR.WARNING }));

      const indexOption = data.options?.find(opt => opt.name === 'index')?.value;
      if (indexOption !== undefined) {
        const idx = Number(indexOption);
        if (Number.isNaN(idx) || idx < 0 || idx >= quotes.length) {
          return res.send(embedReply({ title: 'Índice inválido', description: `Use um índice entre \`0\` e \`${quotes.length - 1}\`.`, color: COLOR.WARNING }));
        }
        return res.send(embedReply({ title: `Frase #${idx}`, description: `> *"${quotes[idx].quote}"*`, color: COLOR.INFO }));
      }

      return res.send(embedReply({
        title: 'Frases proibidas',
        description: quotes.map((q, i) => `\`${i}\` ${q.quote}`).join('\n'),
        color: COLOR.INFO,
        fields: [{ name: 'Total', value: `**${quotes.length}** frase(s)`, inline: true }],
      }));
    }

    if (name === 'monitor-site') {
      const url = data.options[0].value;
      const { error } = await supabase.from('monitored_sites').insert([{ user_id: userId, url }]);
      if (error) {
        return res.send(embedReply({
          title: error.code === '23505' ? '⚠️ Site já monitorado' : '❌ Erro ao adicionar',
          description: error.code === '23505' ? `Você já está monitorando **${url}**.` : 'Não foi possível adicionar o site.',
          color: error.code === '23505' ? COLOR.WARNING : COLOR.ERROR,
        }, true));
      }
      return res.send(embedReply({
        title: 'Monitoramento ativado',
        description: `**${url}** foi adicionado com sucesso.`,
        color: COLOR.SUCCESS,
        fields: [
          { name: 'Verificação', value: 'A cada 5 minutos', inline: true },
          { name: 'Notificação', value: 'Via DM privada',   inline: true },
        ],
      }, true));
    }

    if (name === 'unmonitor-site') {
      const url = data.options[0].value;
      const { error, count } = await supabase.from('monitored_sites').delete({ count: 'exact' }).eq('user_id', userId).eq('url', url);
      if (error) return res.send(embedReply({ title: '❌ Erro ao remover', color: COLOR.ERROR }, true));
      return res.send(embedReply({
        title: count > 0 ? 'Monitoramento removido' : 'Site não encontrado',
        description: count > 0 ? `**${url}** foi removido.` : `Você não estava monitorando **${url}**.`,
        color: count > 0 ? COLOR.DANGER : COLOR.WARNING,
      }, true));
    }

    if (name === 'test-monitor') {
      const { data: sites, error } = await supabase.from('monitored_sites').select().eq('user_id', userId);
      if (error || !sites?.length) {
        return res.send(embedReply({ title: '📭 Nenhum site monitorado', description: 'Use `/monitor-site` para adicionar!', color: COLOR.WARNING }, true));
      }
      for (const site of sites) {
        try { await sendDM(userId, embedTest(site.url)); }
        catch (err) { console.error(`Erro ao enviar DM de teste:`, err); }
      }
      return res.send(embedReply({
        title: 'Teste enviado',
        description: `DM enviada para **${sites.length}** site(s) monitorado(s). Verifique seu privado!`,
        color: COLOR.SUCCESS,
        fields: [{ name: 'Sites', value: sites.map(s => s.url).join('\n') }],
      }, true));
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  setInterval(runMonitoringCycle, MONITOR_INTERVAL_MS);
  runMonitoringCycle();
});
