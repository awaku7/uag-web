// Small, conservative local emotion lexicon for Japanese and English speech text.
// Ambiguous or negated terms fall back to neutral; anger is intentionally not inferred.
export const emotionBlend = {
  neutral: { neutral: 100 },
  happy: { happy: 60, neutral: 40 },
  sad: { sad: 50, neutral: 50 },
  apologetic: { apologetic: 55, neutral: 45 },
};

const terms = {
  happy: [
    ['おめでとう', 3], ['うれし', 2], ['嬉し', 2], ['よかった', 2], ['良かった', 2],
    ['素晴らし', 2], ['すばらし', 2], ['最高', 2], ['楽しみ', 1], ['大成功', 2],
    ['congratulations', 3], ['great news', 2], ['wonderful', 2], ['excited', 2], ['glad', 1],
  ],
  sad: [
    ['お悔やみ', 3], ['ご冥福', 3], ['悲し', 2], ['哀し', 2], ['つら', 2], ['辛', 2],
    ['残念', 2], ['苦し', 1], ['亡くな', 2], ['sorry for your loss', 3], ['disappointed', 2],
    ['unfortunately', 1], ['sad', 2],
  ],
  apologetic: [
    ['申し訳', 3], ['お詫び', 3], ['ごめんなさい', 3], ['ごめん', 2], ['すみません', 2],
    ['i apologize', 3], ['my apologies', 3], ["i'm sorry", 2], ['sorry', 1],
  ],
};

function isNegated(text, index, term) {
  const before = text.slice(Math.max(0, index - 8), index);
  const after = text.slice(index + term.length, index + term.length + 12);
  if (/\bnot\s+$/i.test(before)) return true;
  return /^(?:く(?:は|も)?(?:ない|ありません|なかった|ないです|ありませんでした)|(?:では|じゃ)(?:ない|ありません|なかった)|(?:とは)?言え(?:ない|ません))/u.test(after);
}

export function classifyEmotion(sentence) {
  const normalized = String(sentence || '').toLocaleLowerCase();
  const scores = { happy: 0, sad: 0, apologetic: 0 };
  for (const [emotion, entries] of Object.entries(terms)) {
    for (const [term, weight] of entries) {
      let index = normalized.indexOf(term.toLocaleLowerCase());
      while (index >= 0) {
        if (!isNegated(normalized, index, term.toLocaleLowerCase())) {
          scores[emotion] += weight;
          break;
        }
        index = normalized.indexOf(term.toLocaleLowerCase(), index + term.length);
      }
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2 || ranked[0][1] === ranked[1][1]) return 'neutral';
  return ranked[0][0];
}

export function splitSpeechSegments(text) {
  const segments = [];
  for (const line of String(text || '').split(/\r?\n+/)) {
    const pieces = line.match(/[^。！？!?]+[。！？!?]*|[。！？!?]+/gu) || [];
    segments.push(...pieces.map((piece) => piece.trim()).filter(Boolean));
  }
  return segments;
}
