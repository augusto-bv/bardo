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

const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient('https://yeaisalgrclmemvpibsx.supabase.co', 'sb_publishable_e-4-yNLGA1vrwISDP-gd9Q_zr-gAHeO')

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 * Parse request body and verifies incoming requests using discord-interactions package
 */
app.post('/interactions', verifyKeyMiddleware(process.env.PUBLIC_KEY), async function (req, res) {
  // Interaction id, type and data
  const { id, type, data } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    console.log(data);

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

      let message = quotes.map(q => q.quote).join("\n");

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
    } console.error(`unknown command: ${name}`);
    return res.status(400).json({ error: 'unknown command' });
  }

  console.error('unknown interaction type', type);
  return res.status(400).json({ error: 'unknown interaction type' });
});

app.listen(PORT, () => {
  console.log('Listening on port', PORT);
});
