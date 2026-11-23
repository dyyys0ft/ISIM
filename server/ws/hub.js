import { WebSocketServer } from 'ws';
import { createHash } from 'node:crypto';
import { db, nowIso } from '../db/index.js';
import { saveSignature } from '../modules/signatures.js';
import { accesoPermitido, ipDelCliente } from '../lib/control-ip.js';

const rooms = new Map(); // tokenHash -> Set<WebSocket>

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(tokenHash, payload, except = null) {
  const room = rooms.get(tokenHash);
  if (!room) return;
  for (const client of room) {
    if (client === except) continue;
    send(client, payload);
  }
}

/**
 * Canal WebSocket de la firma. El token del enlace identifica la sesión;
 * el rol (signer/controller) solo se usa para avisar quién está conectado.
 */
export function attachSignatureSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 6 * 1024 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    if (!accesoPermitido(ipDelCliente(req))) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/ws/firma') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('t') || '';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = db.prepare('SELECT * FROM sign_sessions WHERE token_hash = ?').get(tokenHash);

    if (
      !session ||
      session.estado !== 'abierta' ||
      session.expira_en <= nowIso()
    ) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const role = url.searchParams.get('role') === 'signer' ? 'signer' : 'controller';
      ws.role = role;
      ws.tokenHash = tokenHash;
      ws.signSessionId = session.id;
      ws.isAlive = true;
      ws.ip = req.socket.remoteAddress;
      ws.userAgent = req.headers['user-agent'] || '';

      if (!rooms.has(tokenHash)) rooms.set(tokenHash, new Set());
      rooms.get(tokenHash).add(ws);

      send(ws, { type: 'ready', role, sessionId: session.id, expiraEn: session.expira_en });
      if (role === 'signer') broadcast(tokenHash, { type: 'signer-connected' }, ws);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          send(ws, { type: 'error', message: 'Mensaje inválido' });
          return;
        }

        if (message.type === 'ping') {
          send(ws, { type: 'pong' });
          return;
        }

        if (message.type === 'submit') {
          try {
            const result = saveSignature(tokenHash, message.image, {
              ip: ws.ip,
              userAgent: ws.userAgent,
            });
            broadcast(tokenHash, { type: 'signed', ...result });
          } catch (error) {
            send(ws, { type: 'error', message: error.message });
          }
          return;
        }

        if (message.type === 'copia') {
          const solicitada = message.solicitada ? 1 : 0;
          const resultado = db
            .prepare(
              `UPDATE signatures
               SET copia_solicitada = ?, copia_entregada = 0, copia_actualizada_en = ?
               WHERE sign_session_id = ?`
            )
            .run(solicitada, nowIso(), ws.signSessionId);

          if (!resultado.changes) {
            send(ws, { type: 'error', message: 'No se encontró la firma para registrar la copia' });
            return;
          }

          broadcast(tokenHash, { type: 'copia', solicitada: Boolean(solicitada) });
          return;
        }

        if (message.type === 'cancel') {
          db.prepare("UPDATE sign_sessions SET estado = 'cancelada' WHERE id = ? AND estado = 'abierta'").run(
            ws.signSessionId
          );
          broadcast(tokenHash, { type: 'cancelled' });
          return;
        }

        send(ws, { type: 'error', message: 'Tipo de mensaje no soportado' });
      });

      ws.on('close', () => {
        const room = rooms.get(tokenHash);
        if (room) {
          room.delete(ws);
          if (room.size === 0) rooms.delete(tokenHash);
        }
        if (ws.role === 'signer') broadcast(tokenHash, { type: 'signer-disconnected' });
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
