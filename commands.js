import 'dotenv/config';
import { InstallGlobalCommands } from './utils.js';

const DROP_QUOTE_COMMAND = {
    name: "drop-quote",
    description: "Registre uma frase proibida",
    options: [
        {
            name: "frase",
            description: "Frase dita",
            type: 3,
            required: true
        },
    ],
    contexts: [0, 2],
}

const EXPOSE_QUOTES_COMMAND = {
  name: "expose-quotes",
    description: "Veja a coleção de frases proibidas",
    options: [
        {
            name: "index",
            description: "Index da frase",
            type: 4,
            required: false
        },
    ],
    contexts: [0, 2],
}

const MONITOR_SITE_COMMAND = {
  name: 'monitor-site',
  description: 'Adicione um site para ser notificado quando ele cair',
  options: [
    {
      name: 'url',
      description: 'URL do site a monitorar (ex: https://exemplo.com)',
      type: 3,
      required: true,
    },
  ],
  contexts: [0, 2],
};

const UNMONITOR_SITE_COMMAND = {
  name: 'unmonitor-site',
  description: 'Remova um site da sua lista de monitoramento',
  options: [
    {
      name: 'url',
      description: 'URL do site a remover',
      type: 3,
      required: true,
    },
  ],
  contexts: [0, 2],
};

const TEST_MONITOR_COMMAND = {
  name: 'test-monitor',
  description: 'Envia uma DM de teste para todos os seus sites monitorados',
  contexts: [0, 2],
};

const START_TIMER_COMMAND = {
  name: 'start-timer',
  description: 'Inicia um marcador de tempo com título e botões de controle',
  contexts: [0, 2],
};

const ALL_COMMANDS = [DROP_QUOTE_COMMAND, EXPOSE_QUOTES_COMMAND, MONITOR_SITE_COMMAND, UNMONITOR_SITE_COMMAND, TEST_MONITOR_COMMAND, START_TIMER_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
