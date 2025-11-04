/**
 * 随机人名生成模块
 * @module modules/app/random-name
 */

// 音节库
const vowelSyllables = ["a", "e", "i", "o", "u", "ai", "ei", "ou", "ia", "io"];
const consonantSyllables = ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "x", "y", "z"];
const commonSyllables = [
  "al", "an", "ar", "er", "in", "on", "en", "el", "or", "ir",
  "la", "le", "li", "lo", "lu", "ra", "re", "ri", "ro", "ru",
  "na", "ne", "ni", "no", "nu", "ma", "me", "mi", "mo", "mu",
  "ta", "te", "ti", "to", "tu", "sa", "se", "si", "so", "su",
  "ca", "ce", "ci", "co", "cu", "da", "de", "di", "do", "du",
  "fa", "fe", "fi", "fo", "fu", "ga", "ge", "gi", "go", "gu",
  "ba", "be", "bi", "bo", "bu", "va", "ve", "vi", "vo", "vu"
];
const nameFragments = [
  "alex", "max", "sam", "ben", "tom", "joe", "leo", "kai", "ray", "jay",
  "anna", "emma", "lily", "lucy", "ruby", "zoe", "eva", "mia", "ava", "ivy",
  "chen", "wang", "yang", "zhao", "liu", "lin", "zhou", "wu", "xu", "sun"
];

/**
 * 生成自然发音的单词
 * @param {number} targetLen - 目标长度
 * @returns {string}
 */
function makeNaturalWord(targetLen) {
  let word = "";
  let lastWasVowel = false;
  let attempts = 0;
  const maxAttempts = 50;

  while (word.length < targetLen && attempts < maxAttempts) {
    attempts++;
    let syllable;
    
    if (word.length === 0) {
      if (Math.random() < 0.3 && targetLen >= 4) {
        const fragment = nameFragments[Math.floor(Math.random() * nameFragments.length)];
        if (fragment.length <= targetLen) {
          syllable = fragment;
        } else {
          syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
        }
      } else {
        syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
      }
    } else {
      const rand = Math.random();
      if (rand < 0.6) {
        syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
      } else if (rand < 0.8) {
        syllable = lastWasVowel ? 
          consonantSyllables[Math.floor(Math.random() * consonantSyllables.length)] :
          vowelSyllables[Math.floor(Math.random() * vowelSyllables.length)];
      } else {
        syllable = commonSyllables[Math.floor(Math.random() * commonSyllables.length)];
      }
    }

    if (word.length + syllable.length <= targetLen) {
      word += syllable;
      lastWasVowel = /[aeiou]$/.test(syllable);
    } else {
      const shortSyllables = [vowelSyllables, consonantSyllables].flat().filter(s => s.length === 1);
      const remainingLen = targetLen - word.length;
      const fitSyllables = shortSyllables.filter(s => s.length <= remainingLen);
      
      if (fitSyllables.length > 0) {
        syllable = fitSyllables[Math.floor(Math.random() * fitSyllables.length)];
        word += syllable;
      }
      break;
    }
  }

  return word.length > targetLen ? word.slice(0, targetLen) : word;
}

/**
 * 生成随机人名ID
 * @param {number} length - 长度（4-32）
 * @returns {string}
 */
export function generateRandomId(length = 8) {
  const len = Math.max(4, Math.min(32, Number(length) || 8));

  if (len <= 12) {
    return makeNaturalWord(len).toLowerCase();
  } else {
    // 长名字用下划线分割
    const firstLen = Math.max(3, Math.floor((len - 1) * 0.4));
    const lastLen = Math.max(3, len - 1 - firstLen);
    const firstName = makeNaturalWord(firstLen);
    const lastName = makeNaturalWord(lastLen);
    return (firstName + "_" + lastName).toLowerCase();
  }
}

export default { generateRandomId };
