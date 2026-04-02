import 'dotenv/config';
import express from 'express';
import {
  ButtonStyleTypes,
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
  MessageComponentTypes,
  verifyKeyMiddleware,
} from 'discord-interactions';
import { createClient } from '@supabase/supabase-js'
import { DiscordRequest } from './utils.js';

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient('https://yeaisalgrclmemvpibsx.supabase.co', 'sb_publishable_e-4-yNLGA1vrwISDP-gd9Q_zr-gAHeO')

const MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const TIMER_UPDATE_INTERVAL_MS = 60 * 1000;  // 1 minuto

// ─── Cores ────────────────────────────────────────────────────────────────────
const COLOR = {
  SUCCESS: 0x57F287,
  ERROR:   0xED4245,
  WARNING: 0xFEE75C,
  INFO:    0x5865F2,
  DANGER:  0xFF6B35,
  DOWN:    0xFF0000,
  UP:      0x00CC66,
  PAUSED:  0xFEE75C,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)   return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function unixTs(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

// Extrai o timestamp real do snowflake ID da interaction (quando o Discord registrou o evento)
function interactionTs(id) {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
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

// ─── Embeds e botões do timer ─────────────────────────────────────────────────
function calcElapsedMs(timer) {
  const startedAt = new Date(timer.started_at).getTime();
  const totalPaused = timer.total_paused_ms || 0;

  if (timer.status === 'paused' && timer.paused_at) {
    return new Date(timer.paused_at).getTime() - startedAt - totalPaused;
  }
  if ((timer.status === 'finished' || timer.status === 'cancelled') && timer.finished_at) {
    return new Date(timer.finished_at).getTime() - startedAt - totalPaused;
  }
  return Date.now() - startedAt - totalPaused;
}

function buildTimerEmbed(timer) {
  const elapsed = calcElapsedMs(timer);
  const statusMap = {
    running:   { icon: '▶️',  label: 'Rodando',   color: COLOR.SUCCESS },
    paused:    { icon: '⏸️', label: 'Pausado',    color: COLOR.PAUSED  },
    finished:  { icon: '✅',  label: 'Finalizado', color: COLOR.INFO    },
    cancelled: { icon: '❌',  label: 'Cancelado',  color: COLOR.ERROR   },
  };
  const s = statusMap[timer.status] ?? statusMap.running;

  const tempoValue = `\`${formatDuration(elapsed)}\``;

  const fields = [
    { name: 'Status',   value: `${s.icon} ${s.label}`,              inline: true },
    { name: 'Tempo',    value: tempoValue,                           inline: true },
    { name: 'Iniciado', value: `<t:${unixTs(timer.started_at)}:T>`, inline: true },
  ];

  if (timer.status === 'finished' && timer.finished_at) {
    fields.push({ name: 'Finalizado às', value: `<t:${unixTs(timer.finished_at)}:T>`, inline: true });
  }
  if (timer.status === 'paused' && timer.paused_at) {
    fields.push({ name: 'Pausado às', value: `<t:${unixTs(timer.paused_at)}:T>`, inline: true });
  }

  return {
    title: timer.title,
    color: s.color,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'Bardo Timer' },
  };
}

function buildTimerComponents(timer) {
  if (timer.status === 'finished' || timer.status === 'cancelled') return [];
  const isPaused = timer.status === 'paused';
  return [{
    type: MessageComponentTypes.ACTION_ROW,
    components: [
      {
        type: MessageComponentTypes.BUTTON,
        style: isPaused ? ButtonStyleTypes.SUCCESS : ButtonStyleTypes.SECONDARY,
        label: isPaused ? '▶️ Continuar' : '⏸️ Pausar',
        custom_id: isPaused ? `timer_resume:${timer.id}` : `timer_pause:${timer.id}`,
      },
      {
        type: MessageComponentTypes.BUTTON,
        style: ButtonStyleTypes.PRIMARY,
        label: '✅ Finalizar',
        custom_id: `timer_finish:${timer.id}`,
      },
      {
        type: MessageComponentTypes.BUTTON,
        style: ButtonStyleTypes.DANGER,
        label: '❌ Cancelar',
        custom_id: `timer_cancel:${timer.id}`,
      },
    ],
  }];
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

// ─── Loop de atualização dos timers (a cada minuto) ──────────────────────────
async function runTimerUpdateCycle() {
  const { data: timers, error } = await supabase
    .from('timers')
    .select()
    .eq('status', 'running')
    .not('message_id', 'is', null);

  if (error) { console.error('Erro ao buscar timers:', error); return; }

  for (const timer of timers) {
    try {
      await DiscordRequest(`channels/${timer.channel_id}/messages/${timer.message_id}`, {
        method: 'PATCH',
        body: { embeds: [buildTimerEmbed(timer)], components: buildTimerComponents(timer) },
      });
    } catch (err) {
      console.error(`Erro ao atualizar timer ${timer.id}:`, err.message);
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

    if (name === 'start-timer') {
      return res.send({
        type: 9, // MODAL
        data: {
          custom_id: 'start_timer_modal',
          title: 'Novo Marcador de Tempo',
          components: [{
            type: MessageComponentTypes.ACTION_ROW,
            components: [{
              type: 4, // TEXT_INPUT
              custom_id: 'timer_title',
              label: 'Título da tarefa',
              style: 1, // SHORT
              placeholder: 'Ex: Reunião com cliente',
              required: true,
              min_length: 1,
              max_length: 100,
            }],
          }],
        },
      });
    }

    console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  // ── Modal submit ─────────────────────────────────────────────────────────────
  if (type === 5) { // MODAL_SUBMIT
    if (data.custom_id === 'start_timer_modal') {
      const title = data.components[0].components[0].value;
      const channelId = req.body.channel_id;

      const { data: timer, error } = await supabase
        .from('timers')
        .insert([{ user_id: userId, channel_id: channelId, title, status: 'running' }])
        .select()
        .single();

      if (error) {
        return res.send(embedReply({ title: 'Erro ao criar timer', description: 'Tente novamente.', color: COLOR.ERROR }, true));
      }

      // Envia o timer como resposta da interaction
      res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [buildTimerEmbed(timer)],
          components: buildTimerComponents(timer),
        },
      });

      // Pega o message_id para o background job poder editar a cada minuto
      setTimeout(async () => {
        try {
          const msgRes = await DiscordRequest(`webhooks/${process.env.APP_ID}/${req.body.token}/messages/@original`, { method: 'GET' });
          const msg = await msgRes.json();
          await supabase.from('timers').update({ message_id: msg.id }).eq('id', timer.id);
        } catch (err) {
          console.error('Erro ao obter message_id do timer:', err.message);
        }
      }, 1000);

      return;
    }
  }

  // ── Botões dos timers ────────────────────────────────────────────────────────
  if (type === InteractionType.MESSAGE_COMPONENT) {
    const [action, timerId] = data.custom_id.split(':');
    const timerActions = ['timer_pause', 'timer_resume', 'timer_finish', 'timer_cancel'];

    if (timerActions.includes(action)) {
      const { data: timer, error } = await supabase.from('timers').select().eq('id', timerId).single();
      if (error || !timer) {
        return res.send({ type: 7, data: { embeds: [{ title: '❌ Timer não encontrado', color: COLOR.ERROR }], components: [] } });
      }

      // Usa o timestamp do snowflake da interaction para evitar delay de rede
      const now = interactionTs(req.body.id);

      if (action === 'timer_pause' && timer.status === 'running') {
        await supabase.from('timers').update({ status: 'paused', paused_at: now.toISOString() }).eq('id', timerId);
        Object.assign(timer, { status: 'paused', paused_at: now.toISOString() });

      } else if (action === 'timer_resume' && timer.status === 'paused') {
        const pausedMs = now - new Date(timer.paused_at);
        const newTotal = (timer.total_paused_ms || 0) + pausedMs;
        await supabase.from('timers').update({ status: 'running', paused_at: null, total_paused_ms: newTotal }).eq('id', timerId);
        Object.assign(timer, { status: 'running', paused_at: null, total_paused_ms: newTotal });

      } else if (action === 'timer_finish') {
        await supabase.from('timers').update({ status: 'finished', finished_at: now.toISOString() }).eq('id', timerId);
        Object.assign(timer, { status: 'finished', finished_at: now.toISOString() });

      } else if (action === 'timer_cancel') {
        await supabase.from('timers').update({ status: 'cancelled', finished_at: now.toISOString() }).eq('id', timerId);
        Object.assign(timer, { status: 'cancelled', finished_at: now.toISOString() });
      }

      return res.send({
        type: 7, // UPDATE_MESSAGE
        data: {
          embeds: [buildTimerEmbed(timer)],
          components: buildTimerComponents(timer),
        },
      });
    }
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
  setInterval(runMonitoringCycle, MONITOR_INTERVAL_MS);
  setInterval(runTimerUpdateCycle, TIMER_UPDATE_INTERVAL_MS);
  runMonitoringCycle();
});
