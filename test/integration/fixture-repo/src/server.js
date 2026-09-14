import { createServer } from 'node:http';

export function classify(value) {
  if (value > 10) return 'large';
  if (value > 0) return 'small';
  return 'empty';
}

createServer((_request, response) => response.end(classify(12))).listen(Number(process.env.PORT ?? 0), '0.0.0.0');
