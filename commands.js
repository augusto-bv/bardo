import 'dotenv/config';
import { capitalize, InstallGlobalCommands } from './utils.js';

// Simple test command
const TEST_COMMAND = {
  name: 'test',
  description: 'Basic command',
  type: 1,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

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

const ALL_COMMANDS = [DROP_QUOTE_COMMAND,EXPOSE_QUOTES_COMMAND];

InstallGlobalCommands(process.env.APP_ID, ALL_COMMANDS);
