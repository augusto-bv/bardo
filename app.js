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

async function isSiteDown(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return !res.ok;
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

function embedDown(url) {
  return {
    title: '🔴 Site fora do ar',
    description: `O site **${url}** está fora do ar!`,
    color: 0xFF0000,
    timestamp: new Date().toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

function embedUp(url) {
  return {
    title: '🟢 Site voltou ao ar',
    description: `O site **${url}** está funcionando novamente!`,
    color: 0x00CC66,
    timestamp: new Date().toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

function embedTest(url) {
  return {
    title: '🧪 Teste de monitoramento',
    description: `Se o site **${url}** cair, você receberá uma notificação como esta.`,
    color: 0x5865F2,
    timestamp: new Date().toISOString(),
    footer: { text: 'Bardo Monitor' },
  };
}

async function runMonitoringCycle() {
  const { data: sites, error } = await supabase.from('monitored_sites').select();
  if (error) {
    console.error('Erro ao buscar sites monitorados:', error);
    return;
  }

  for (const site of sites) {
    const down = await isSiteDown(site.url);

    if (down && !site.is_down) {
      await supabase
        .from('monitored_sites')
        .update({ is_down: true })
        .eq('id', site.id);

      try {
        await sendDM(site.user_id, embedDown(site.url));
      } catch (err) {
        console.error(`Erro ao enviar DM para ${site.user_id}:`, err);
      }
    } else if (!down && site.is_down) {
      await supabase
        .from('monitored_sites')
        .update({ is_down: false })
        .eq('id', site.id);

      try {
        await sendDM(site.user_id, embedUp(site.url));
      } catch (err) {
        console.error(`Erro ao enviar DM para ${site.user_id}:`, err);
      }
    }
  }
}

app.get('/ping', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === 'drop-quote') {
      const newQuote = data.options[0]['value'];

      const { data: inserted, error } = await supabase
        .from('quotes')
        .insert([{ quote: newQuote }]);

      if (error) {
        console.error(error);
        return res.status(500).send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: 'Erro ao registrar a frase'
              }
            ]
          },
        });
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: 'Frase proibida registrada'
            }
          ]
        },
      });
    }

    if (name === 'expose-quotes') {
      const { data: quotes, error } = await supabase
        .from('quotes')
        .select();

      if (error) {
        console.error(error);
        return res.status(500).send({ content: "Erro ao buscar as frases" });
      }

      if (!quotes || quotes.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: "Nenhuma frase registrada."
              }
            ]
          },
        });
      }

      const indexOption = req.body.data?.options?.find(opt => opt.name === 'index')?.value;
      let message;
      if (indexOption !== undefined) {
        const idx = Number(indexOption);
        if (Number.isNaN(idx) || idx < 0 || idx >= quotes.length) {
          message = "Índice inválido.";
        } else {
          message = quotes[idx].quote;
        }
      } else {
        message = quotes.map(q => q.quote).join("\n");
      }

      console.log(message);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: message
            }
          ]
        },
      });
    }

    if (name === 'monitor-site') {
      const userId = req.body.member?.user?.id ?? req.body.user?.id;
      const url = data.options[0].value;

      const { error } = await supabase
        .from('monitored_sites')
        .insert([{ user_id: userId, url }]);

      if (error) {
        const alreadyExists = error.code === '23505';
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: alreadyExists
                  ? `Você já está monitorando **${url}**.`
                  : `Erro ao adicionar o site para monitoramento.`,
              },
            ],
          },
        });
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: `✅ Site **${url}** adicionado ao monitoramento. Você receberá uma DM quando ele cair.`,
            },
          ],
        },
      });
    }

    if (name === 'test-monitor') {
      const userId = req.body.member?.user?.id ?? req.body.user?.id;

      const { data: sites, error } = await supabase
        .from('monitored_sites')
        .select()
        .eq('user_id', userId);

      if (error || !sites || sites.length === 0) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: 'Você não tem nenhum site monitorado. Use `/monitor-site` primeiro.',
              },
            ],
          },
        });
      }

      for (const site of sites) {
        try {
          await sendDM(userId, embedTest(site.url));
        } catch (err) {
          console.error(`Erro ao enviar DM de teste para ${userId}:`, err);
        }
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: `✅ DM de teste enviada para ${sites.length} site(s) monitorado(s). Verifique seu privado!`,
            },
          ],
        },
      });
    }

    if (name === 'unmonitor-site') {
      const userId = req.body.member?.user?.id ?? req.body.user?.id;
      const url = data.options[0].value;

      const { error, count } = await supabase
        .from('monitored_sites')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('url', url);

      if (error) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
            components: [
              {
                type: MessageComponentTypes.TEXT_DISPLAY,
                content: 'Erro ao remover o site do monitoramento.',
              },
            ],
          },
        });
      }

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: InteractionResponseFlags.IS_COMPONENTS_V2 | InteractionResponseFlags.EPHEMERAL,
          components: [
            {
              type: MessageComponentTypes.TEXT_DISPLAY,
              content: count > 0
                ? `🗑️ Site **${url}** removido do monitoramento.`
                : `Você não estava monitorando **${url}**.`,
            },
          ],
        },
      });
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
