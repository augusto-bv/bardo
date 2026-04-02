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

/*
 * Tabela necessária no Supabase:
 *
 * CREATE TABLE monitored_sites (
 *   id        BIGSERIAL PRIMARY KEY,
 *   user_id   TEXT NOT NULL,
 *   url       TEXT NOT NULL,
 *   is_down   BOOLEAN DEFAULT FALSE,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   UNIQUE(user_id, url)
 * );
 */

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient('https://yeaisalgrclmemvpibsx.supabase.co', 'sb_publishable_e-4-yNLGA1vrwISDP-gd9Q_zr-gAHeO')

const MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

// ─── Cores ────────────────────────────────────────────────────────────────────
const COLOR = {
  SUCCESS:  0x57F287, // verde
  ERROR:    0xED4245, // vermelho
  WARNING:  0xFEE75C, // amarelo
  INFO:     0x5865F2, // roxo Discord
  DANGER:   0xFF6B35, // laranja
  DOWN:     0xFF0000, // vermelho vivo
  UP:       0x00CC66, // verde vivo
  TEST:     0x5865F2, // roxo
};

// ─── Helper de resposta com embed ────────────────────────────────────────────
function embedReply(embed, ephemeral = false) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      flags: ephemeral ? InteractionResponseFlags.EPHEMERAL : 0,
      embeds: [{
        ...embed,
        timestamp: new Date().toISOString(),
        footer: { text: '✨ Bardo' },
      }],
    },
  };
}

// ─── Embeds das DMs de monitoramento ─────────────────────────────────────────
function embedDown(url) {
  return {
    title: '🚨 Site fora do ar!',
    description: `O site abaixo parou de responder e pode estar fora do ar.\n\n🔗 **${url}**`,
    color: COLOR.DOWN,
    fields: [{ name: '📡 Status', value: '`Sem resposta`', inline: true }],
    timestamp: new Date().toISOString(),
    footer: { text: '🔔 Bardo Monitor' },
  };
}

function embedUp(url) {
  return {
    title: '✅ Site voltou ao ar!',
    description: `Boas notícias! O site voltou a responder normalmente.\n\n🔗 **${url}**`,
    color: COLOR.UP,
    fields: [{ name: '📡 Status', value: '`Online`', inline: true }],
    timestamp: new Date().toISOString(),
    footer: { text: '🔔 Bardo Monitor' },
  };
}

function embedTest(url) {
  return {
    title: '🧪 Notificação de teste',
    description: `Tudo certo! Quando o site abaixo cair, você receberá uma mensagem como esta.\n\n🔗 **${url}**`,
    color: COLOR.TEST,
    fields: [{ name: '📡 Status', value: '`Monitorando...`', inline: true }],
    timestamp: new Date().toISOString(),
    footer: { text: '🔔 Bardo Monitor' },
  };
}

// ─── Funções utilitárias ──────────────────────────────────────────────────────
async function isSiteDown(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    // 4xx = servidor respondendo (site no ar); só 5xx e erros de rede = fora
    return res.status >= 500;
  } catch {
    return true;
  }
}

async function sendDM(userId, embed) {
  const dmRes = await DiscordRequest('users/@me/channels', {
    method: 'POST',
    body: { recipient_id: userId },
  });
  const { id: channelId } = await dmRes.json();
  await DiscordRequest(`channels/${channelId}/messages`, {
    method: 'POST',
    body: { embeds: [embed] },
  });
}

// ─── Loop de monitoramento ────────────────────────────────────────────────────
async function runMonitoringCycle() {
  const { data: sites, error } = await supabase.from('monitored_sites').select();
  if (error) {
    console.error('Erro ao buscar sites monitorados:', error);
    return;
  }

  for (const site of sites) {
    const down = await isSiteDown(site.url);

    if (down && !site.is_down) {
      await supabase.from('monitored_sites').update({ is_down: true }).eq('id', site.id);
      try { await sendDM(site.user_id, embedDown(site.url)); }
      catch (err) { console.error(`Erro ao enviar DM para ${site.user_id}:`, err); }
    } else if (!down && site.is_down) {
      await supabase.from('monitored_sites').update({ is_down: false }).eq('id', site.id);
      try { await sendDM(site.user_id, embedUp(site.url)); }
      catch (err) { console.error(`Erro ao enviar DM para ${site.user_id}:`, err); }
    }
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
app.get('/ping', (req, res) => res.status(200).json({ status: 'alive' }));

app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  const { type, data } = req.body;

  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;
    const userId = req.body.member?.user?.id ?? req.body.user?.id;

    // ── drop-quote ────────────────────────────────────────────────────────────
    if (name === 'drop-quote') {
      const newQuote = data.options[0].value;

      const { error } = await supabase.from('quotes').insert([{ quote: newQuote }]);

      if (error) {
        console.error(error);
        return res.send(embedReply({
          title: '❌ Erro ao registrar',
          description: 'Não foi possível salvar a frase. Tente novamente.',
          color: COLOR.ERROR,
        }, true));
      }

      return res.send(embedReply({
        title: '🤫 Frase proibida registrada!',
        description: `A frase foi adicionada ao acervo secreto.\n\n> *"${newQuote}"*`,
        color: COLOR.INFO,
      }, true));
    }

    // ── expose-quotes ─────────────────────────────────────────────────────────
    if (name === 'expose-quotes') {
      const { data: quotes, error } = await supabase.from('quotes').select();

      if (error) {
        console.error(error);
        return res.send(embedReply({
          title: '❌ Erro ao buscar frases',
          description: 'Não foi possível carregar o acervo. Tente novamente.',
          color: COLOR.ERROR,
        }));
      }

      if (!quotes || quotes.length === 0) {
        return res.send(embedReply({
          title: '📭 Nenhuma frase registrada',
          description: 'O acervo está vazio. Use `/drop-quote` para adicionar a primeira!',
          color: COLOR.WARNING,
        }));
      }

      const indexOption = data.options?.find(opt => opt.name === 'index')?.value;

      if (indexOption !== undefined) {
        const idx = Number(indexOption);
        if (Number.isNaN(idx) || idx < 0 || idx >= quotes.length) {
          return res.send(embedReply({
            title: '⚠️ Índice inválido',
            description: `Existem **${quotes.length}** frases no acervo. Use um índice entre \`0\` e \`${quotes.length - 1}\`.`,
            color: COLOR.WARNING,
          }));
        }
        return res.send(embedReply({
          title: `📖 Frase #${idx}`,
          description: `> *"${quotes[idx].quote}"*`,
          color: COLOR.INFO,
        }));
      }

      const lista = quotes.map((q, i) => `\`${i}\` ${q.quote}`).join('\n');
      return res.send(embedReply({
        title: `📚 Acervo de frases proibidas`,
        description: lista,
        color: COLOR.INFO,
        fields: [{ name: '📊 Total', value: `**${quotes.length}** frase(s)`, inline: true }],
      }));
    }

    // ── monitor-site ──────────────────────────────────────────────────────────
    if (name === 'monitor-site') {
      const url = data.options[0].value;

      const { error } = await supabase.from('monitored_sites').insert([{ user_id: userId, url }]);

      if (error) {
        const alreadyExists = error.code === '23505';
        return res.send(embedReply({
          title: alreadyExists ? '⚠️ Site já monitorado' : '❌ Erro ao adicionar',
          description: alreadyExists
            ? `Você já está monitorando **${url}**.`
            : 'Não foi possível adicionar o site. Tente novamente.',
          color: alreadyExists ? COLOR.WARNING : COLOR.ERROR,
        }, true));
      }

      return res.send(embedReply({
        title: '🔔 Monitoramento ativado!',
        description: `O site foi adicionado com sucesso.\n\n🔗 **${url}**`,
        color: COLOR.SUCCESS,
        fields: [
          { name: '📡 Verificação', value: 'A cada 5 minutos', inline: true },
          { name: '📬 Notificação', value: 'Via DM privada', inline: true },
        ],
      }, true));
    }

    // ── unmonitor-site ────────────────────────────────────────────────────────
    if (name === 'unmonitor-site') {
      const url = data.options[0].value;

      const { error, count } = await supabase
        .from('monitored_sites')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('url', url);

      if (error) {
        return res.send(embedReply({
          title: '❌ Erro ao remover',
          description: 'Não foi possível remover o site. Tente novamente.',
          color: COLOR.ERROR,
        }, true));
      }

      return res.send(embedReply({
        title: count > 0 ? '🔕 Monitoramento removido' : '⚠️ Site não encontrado',
        description: count > 0
          ? `O site **${url}** foi removido da sua lista de monitoramento.`
          : `Você não estava monitorando **${url}**.`,
        color: count > 0 ? COLOR.DANGER : COLOR.WARNING,
      }, true));
    }

    // ── test-monitor ──────────────────────────────────────────────────────────
    if (name === 'test-monitor') {
      const { data: sites, error } = await supabase
        .from('monitored_sites')
        .select()
        .eq('user_id', userId);

      if (error || !sites || sites.length === 0) {
        return res.send(embedReply({
          title: '📭 Nenhum site monitorado',
          description: 'Você ainda não tem sites na sua lista. Use `/monitor-site` para adicionar!',
          color: COLOR.WARNING,
        }, true));
      }

      for (const site of sites) {
        try { await sendDM(userId, embedTest(site.url)); }
        catch (err) { console.error(`Erro ao enviar DM de teste para ${userId}:`, err); }
      }

      return res.send(embedReply({
        title: '🧪 Teste enviado!',
        description: `DM de teste enviada para **${sites.length}** site(s) monitorado(s).\nVerifique seu privado! 📬`,
        color: COLOR.SUCCESS,
        fields: [{ name: '📋 Sites monitorados', value: sites.map(s => `🔗 ${s.url}`).join('\n'), inline: false }],
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
