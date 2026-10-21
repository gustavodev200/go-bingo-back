import {
  gaudManilhaName,
  gaudStrength,
  gaudTeamOf,
  type GaudChatKey,
  type GaudMatchView,
  type GaudPrivateHand,
  type GaudSeat,
} from '../../contracts';
import type { RandomInt } from '../../core/random';

/** Pedido do parceiro humano que muda a próxima carta da CPU. */
export type GaudBotOrder = 'low' | 'kill';

export interface GaudBotReply {
  text: string;
  order?: GaudBotOrder;
}

const pick = (random: RandomInt, options: readonly string[]) =>
  options[random(0, options.length)];

/** Maior carta jogada (aberta) na rodada atual e se é da minha dupla. */
function tableTop(view: GaudMatchView, seat: GaudSeat) {
  const round = view.rounds[view.rounds.length - 1];
  const shown = round.plays.filter((p) => p.card && !p.hidden);
  if (shown.length === 0) return null;
  const top = shown.reduce((a, b) =>
    gaudStrength(b.card!) > gaudStrength(a.card!) ? b : a,
  );
  return {
    strength: gaudStrength(top.card!),
    ours: gaudTeamOf(top.seat) === gaudTeamOf(seat),
  };
}

function strongCards(hand: GaudPrivateHand) {
  return hand.cards.filter((c) => gaudStrength(c.card) >= 9);
}

/** Como a CPU chama a própria melhor carta ("o Espadão", "um 3"). */
function bestCardName(hand: GaudPrivateHand): string | null {
  const best = [...hand.cards].sort(
    (a, b) => gaudStrength(b.card) - gaudStrength(a.card),
  )[0];
  if (!best || gaudStrength(best.card) < 9) return null;
  const manilha = gaudManilhaName(best.card);
  if (manilha === 'Espadão' || manilha === 'Bastião') return `o ${manilha}`;
  if (manilha) return `o ${manilha.toLowerCase()}`;
  return `um ${best.card.rank}`;
}

/**
 * Resposta da CPU parceira: honesta, olhando só a própria mão e a mesa.
 * `low`/`kill` também viram uma ordem para a próxima carta dela.
 */
export function partnerReply(
  key: GaudChatKey,
  seat: GaudSeat,
  hand: GaudPrivateHand,
  view: GaudMatchView,
  random: RandomInt,
): GaudBotReply {
  const round = view.rounds[view.rounds.length - 1];
  const played = round.plays.some((p) => p.seat === seat);
  const top = tableTop(view, seat);
  const beats = (min: number) =>
    hand.cards.some((c) => gaudStrength(c.card) > min);
  const strong = strongCards(hand);

  switch (key) {
    case 'first': {
      if (view.rounds.length > 1)
        return {
          text:
            view.rounds[0].result === gaudTeamOf(seat)
              ? 'A primeira já é nossa!'
              : 'A primeira já foi, bora pras outras.',
        };
      if (played) return { text: 'Já joguei a minha nessa.' };
      if (top && !top.ours)
        return {
          text: beats(top.strength)
            ? 'Essa eu mato, deixa comigo!'
            : 'Essa não consigo matar...',
        };
      const name = bestCardName(hand);
      if (name && strong.some((c) => gaudStrength(c.card) >= 11))
        return { text: `Faço sim, tenho ${name}!` };
      if (name) return { text: `Acho que faço, tenho ${name}.` };
      return { text: 'Na primeira não garanto, tô fraco.' };
    }
    case 'cards': {
      if (hand.cards.length === 0) return { text: 'Já joguei tudo.' };
      const name = bestCardName(hand);
      if (!name) return { text: 'Tô sem carta, só miudeza.' };
      return {
        text:
          strong.length >= 2
            ? `Tenho ${name} e mais ${strong.length - 1} boa!`
            : `Tenho ${name}.`,
      };
    }
    case 'envido':
      if (view.envidoClosed) return { text: 'O envido já passou nessa mão.' };
      return {
        text:
          hand.envido >= 28
            ? `Tenho ${hand.envido} de envido, pode pedir!`
            : hand.envido >= 25
              ? `Tenho ${hand.envido}, dá pra arriscar.`
              : `Só ${hand.envido} de envido, melhor não.`,
      };
    case 'flor':
      return { text: hand.flor ? 'Tenho flor! 🌸' : 'Flor não tenho.' };
    case 'truco': {
      if (view.trucoValue >= 4) return { text: 'Já tá no vale 4!' };
      const won = view.rounds.filter(
        (r) => r.result === gaudTeamOf(seat),
      ).length;
      if (strong.length >= 2 || (won >= 1 && strong.length >= 1))
        return { text: 'Pede que eu seguro!' };
      if (strong.length === 1) return { text: 'Dá pra arriscar.' };
      return { text: 'Melhor não, tô fraco.' };
    }
    case 'low':
      if (played || hand.cards.length === 0)
        return { text: 'Já joguei nessa rodada.' };
      return { text: 'Beleza, jogo baixo.', order: 'low' };
    case 'kill':
      if (played || hand.cards.length === 0)
        return { text: 'Já joguei nessa rodada.' };
      if (top && top.ours) return { text: 'Já é nossa, guardo a boa.' };
      if (top && !beats(top.strength))
        return { text: 'Não tenho como matar essa 😬' };
      return { text: 'Deixa comigo!', order: 'kill' };
    case 'strong':
      return {
        text: pick(random, ['Então vamos pra cima!', 'Boa, parceiro!']),
      };
    case 'weak':
      return {
        text: pick(random, ['Deixa que eu seguro.', 'Tranquilo, eu me viro.']),
      };
    case 'yes':
      return { text: 'Fechou!' };
    case 'no':
      return { text: 'Entendido.' };
    default:
      return { text: 'Hã?' };
  }
}

/** Resposta da CPU adversária para a mesa: provoca e às vezes blefa. */
export function opponentReply(
  key: GaudChatKey,
  hand: GaudPrivateHand,
  random: RandomInt,
): GaudBotReply {
  const strong = strongCards(hand).length;
  const bluff = random(0, 3) === 0;
  switch (key) {
    case 'nice':
      return {
        text: pick(random, ['Valeu, tchê!', 'Obrigado, essa foi de leve.']),
      };
    case 'gg':
      return { text: 'Bom jogo! Bah, que partida.' };
    case 'hurry':
      return {
        text: pick(random, ['Calma, tô pensando...', 'Já vai, já vai!']),
      };
    case 'cards':
      if (strong >= 2 || bluff)
        return {
          text: pick(random, [
            'Tô cheio de carta aqui!',
            'Tenho o que tu precisa ver.',
          ]),
        };
      return {
        text: pick(random, [
          'Hmm, sei não...',
          'Carta eu tenho, quero ver tu adivinhar.',
        ]),
      };
    case 'truco':
    case 'taunt':
    default:
      if (strong >= 2 || bluff)
        return {
          text: pick(random, [
            'Vem pro pau, tchê!',
            'Pede truco se for homem!',
            'Pode vir que eu quero!',
          ]),
        };
      return {
        text: pick(random, ['Calma lá, tchê...', 'Não me assusta não.']),
      };
  }
}
