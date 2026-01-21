'use strict';

const KNOWN_TYPES = new Set([
  'start_session',
  'send_input',
  'resize',
  'stop_session',
  'output',
  'exit',
  'error',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isStartSession(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'start_session') return false;
  if (!isString(value.session_id)) return false;
  if (!isString(value.cmd)) return false;
  if (!isNumber(value.cols)) return false;
  if (!isNumber(value.rows)) return false;
  if (value.cwd !== undefined && value.cwd !== null && !isString(value.cwd)) return false;
  if (value.env !== undefined && !isObject(value.env)) return false;
  return true;
}

function isSendInput(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'send_input') return false;
  if (!isString(value.session_id)) return false;
  if (!isString(value.text)) return false;
  return true;
}

function isResize(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'resize') return false;
  if (!isString(value.session_id)) return false;
  if (!isNumber(value.cols)) return false;
  if (!isNumber(value.rows)) return false;
  return true;
}

function isStopSession(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'stop_session') return false;
  if (!isString(value.session_id)) return false;
  return true;
}

function isOutput(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'output') return false;
  if (!isString(value.session_id)) return false;
  if (!isString(value.stream)) return false;
  if (!isString(value.chunk)) return false;
  return true;
}

function isExit(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'exit') return false;
  if (!isString(value.session_id)) return false;
  if (!isNumber(value.exit_code)) return false;
  return true;
}

function isErrorMessage(value) {
  if (!isObject(value)) return false;
  if (value.type !== 'error') return false;
  if (!isString(value.session_id)) return false;
  if (!isString(value.message)) return false;
  if (!isBoolean(value.recoverable)) return false;
  return true;
}

function parseLine(line) {
  if (!isString(line)) {
    return { type: 'unknown', raw: line };
  }
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { type: 'unknown', raw: line };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { type: 'unknown', raw: line };
  }

  if (!isObject(parsed) || !isString(parsed.type)) {
    return { type: 'unknown', raw: parsed };
  }

  switch (parsed.type) {
    case 'start_session':
      return isStartSession(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'send_input':
      return isSendInput(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'resize':
      return isResize(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'stop_session':
      return isStopSession(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'output':
      return isOutput(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'exit':
      return isExit(parsed) ? parsed : { type: 'unknown', raw: parsed };
    case 'error':
      return isErrorMessage(parsed) ? parsed : { type: 'unknown', raw: parsed };
    default:
      return { type: 'unknown', raw: parsed };
  }
}

function serializeMessage(message) {
  if (!isObject(message) || !isString(message.type)) {
    throw new Error('message.type is required');
  }

  if (message.type === 'unknown') {
    const raw = Object.prototype.hasOwnProperty.call(message, 'raw') ? message.raw : message;
    return JSON.stringify(raw) + '\n';
  }

  if (!KNOWN_TYPES.has(message.type)) {
    throw new Error(`unsupported message type: ${message.type}`);
  }

  const validators = {
    start_session: isStartSession,
    send_input: isSendInput,
    resize: isResize,
    stop_session: isStopSession,
    output: isOutput,
    exit: isExit,
    error: isErrorMessage,
  };

  if (!validators[message.type](message)) {
    throw new Error(`invalid message payload: ${message.type}`);
  }

  return JSON.stringify(message) + '\n';
}

module.exports = {
  KNOWN_TYPES,
  parseLine,
  serializeMessage,
};
