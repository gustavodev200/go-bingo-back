# Chat de voz

Voz ao vivo dentro das salas de Bingo, Truco e UNO, direto no navegador.

## Como funciona

- **Áudio P2P (WebRTC, malha completa).** Cada jogador abre uma conexão com
  cada outro jogador do canal. O áudio nunca passa pelo servidor.
- **Sinalização pelo namespace `/voice`** (Socket.IO). O servidor só:
  1. autentica o socket (mesmo JWT do Supabase dos jogos);
  2. confere que o usuário está na sala do jogo (`VOICE_MEMBERSHIP`:
     `RoomMember` no Bingo, `roomOf()` no Truco/UNO);
  3. repassa offer/answer/ICE entre peers do mesmo canal.
- **Canal = `voice:<jogo>:<código>`**, no máximo `VOICE_MAX_PEERS` (8) pessoas —
  numa malha cada um envia o próprio áudio uma vez para cada outro.
- **Quem chega oferece** para todos que já estão no canal; quem já estava só
  responde. Assim dois peers nunca mandam offer um para o outro ao mesmo tempo.
- **Uma sessão por usuário e canal:** entrar por outra aba derruba a anterior
  (`voice:removed` com `replaced`).
- **Varredura a cada 10 s:** quem saiu ou foi expulso da sala do jogo sai da voz
  (`voice:removed` com `not_member`).
- Sem permissão de microfone o jogador entra **só ouvindo**.

## Eventos

| Cliente → servidor (ack) | Servidor → cliente |
|---|---|
| `voice:join {game, code, muted}` → `{peerId, peers, iceServers}` | `voice:peer_joined` |
| `voice:signal {to, data}` | `voice:signal {from, data}` |
| `voice:mute {muted}` | `voice:peer_updated` |
| `voice:leave` | `voice:peer_left`, `voice:removed` |

## Produção: TURN

Só com STUN (padrão: STUN público do Google), jogadores atrás de NAT
restritivo — 4G/5G com CGNAT, redes corporativas — **não se ouvem**. Para
produção configure um servidor TURN em `VOICE_ICE_SERVERS` (JSON), por exemplo
coturn próprio ou um serviço gerenciado:

```env
VOICE_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.exemplo.com:3478","turns:turn.exemplo.com:5349"],"username":"u","credential":"p"}]
```

As credenciais vão para o navegador dos jogadores; use credenciais de TURN
restritas a esse uso (idealmente temporárias).

No front, o header `Permissions-Policy` libera `microphone=(self)`.
