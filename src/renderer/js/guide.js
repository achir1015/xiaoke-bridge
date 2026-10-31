// 橋牌教學與系統說明：動畫示範＋語音講解＋練習題
import { $, $$, h, toast } from './util.js';
import { cardFromCode, cardName, suitOf, rankOf, hcpOf, scoreContract, sideOf, callName, SEATS, RANKS, STRAIN_SYM } from './rules.js';
import { cardUrl } from './cards.js';

// 牌的寫法：'SA HK D9 CT'
export const C = (str) => String(str).trim().split(/\s+/).filter(Boolean).map(cardFromCode);

const cards = (rows) => ({ t: 'cards', rows });
const text = (s) => ({ t: 'text', s });

// 教學用牌桌：hands 是每家的簡短牌，plays 依序打出（會動畫飛到中間），trump 是王牌花色（0♠ 1♥ 2♦ 3♣，-1 無王）
export const LESSONS = [
  {
    id: 'intro', title: '認識橋牌', steps: [
      { say: '橋牌是四個人玩、兩兩一隊的牌戲。坐對面的兩人是夥伴：南家和北家一隊，東家和西家一隊。', show: { t: 'table', hands: { n: '夥伴', s: '夥伴', e: '對手', w: '對手' } } },
      { say: '用一副 52 張的撲克牌，沒有鬼牌，每個人拿 13 張。', show: cards([{ label: '每門 13 張，共四門', cards: 'SA SK SQ SJ ST S9 S8 S7 S6 S5 S4 S3 S2' }]) },
      { say: '四種花色有高低之分：黑桃最高，接著是紅心、方塊，梅花最低。黑桃和紅心叫做「高花」，方塊和梅花叫做「低花」。', show: cards([{ label: '高花', cards: 'SA HA' }, { label: '低花', cards: 'DA CA' }]) },
      { say: '同一門裡面，A 最大，接著是 K、Q、J、10，一路到 2 最小。', show: cards([{ label: '大 → 小', cards: 'SA SK SQ SJ ST S9 S2', hl: [0] }]) },
      { say: '一副牌分成兩個階段：先「叫牌」，決定要打什麼合約；再「打牌」，看能不能做到。整副牌一共打 13 墩。', show: text('叫牌 → 打牌（13 墩）→ 計分') },
    ],
  },
  {
    id: 'points', title: '牌力計算', steps: [
      { say: '怎麼知道自己的牌好不好？最簡單的方法是算大牌點：A 算 4 點、K 算 3 點、Q 算 2 點、J 算 1 點。', show: cards([{ label: '4 點、3 點、2 點、1 點', cards: 'SA HK DQ CJ' }]) },
      { say: '整副牌一共 40 點，平均每家 10 點。', show: { t: 'kv', rows: [['A × 4', '16 點'], ['K × 4', '12 點'], ['Q × 4', '8 點'], ['J × 4', '4 點'], ['合計', '40 點']] } },
      { say: '來算一手牌：黑桃 A K，紅心 Q，方塊 J，梅花 Q。四加三加二加一加二，一共 12 點。', show: cards([{ label: '這手 12 點', cards: 'SA SK S4 S3 HQ H5 H2 DJ D8 D4 CQ C7 C3', hl: [0, 1, 4, 7, 10] }]) },
      { say: '牌型也很重要。一門牌超過四張，第五張起每張可以多算一點，因為長門的小牌之後也能贏。', show: cards([{ label: '長門：第五、六張各加 1 點', cards: 'SA SK SQ S9 S7 S4', hl: [4, 5] }]) },
    ],
  },
  {
    id: 'trick', title: '贏墩與跟牌', steps: [
      { say: '打牌時，一人領出一張，其他三家順時針輪流各出一張，這四張牌就叫一「墩」。', show: { t: 'table', trump: -1, plays: [['n', 'SK'], ['e', 'S3'], ['s', 'SA'], ['w', 'S2']], win: 's', note: '南家的 A 最大，贏這一墩' } },
      { say: '最重要的規則：手上有領出的那門花色，就一定要跟。同一門裡面最大的牌贏這一墩，贏的人下一墩先領。', show: { t: 'table', trump: -1, plays: [['s', 'HQ'], ['w', 'H3'], ['n', 'H7'], ['e', 'HK']], win: 'e', note: '東家的 K 最大' } },
      { say: '手上沒有那門花色時，才可以墊別的牌。無王合約裡，墊的牌再大也贏不了。', show: { t: 'table', trump: -1, plays: [['n', 'DA'], ['e', 'SA'], ['s', 'D2'], ['w', 'D3']], win: 'n', note: '東家沒有方塊，墊黑桃 A 也沒用' } },
    ],
  },
  {
    id: 'trump', title: '王牌', steps: [
      { say: '合約如果指定一門花色當「王牌」，那門的牌就比其他三門都大。', show: cards([{ label: '王牌是黑桃時，最小的黑桃 2 也贏紅心 A', cards: 'S2 HA', hl: [0] }]) },
      { say: '手上沒有領出的花色時，可以出王牌把這一墩吃下來，叫做「王吃」。', show: { t: 'table', trump: 0, plays: [['w', 'DA'], ['n', 'D5'], ['e', 'S2'], ['s', 'D3']], win: 'e', note: '王牌是黑桃：東家王吃' } },
      { say: '別人王吃之後，還沒出牌的人如果也沒有這門，可以用更大的王牌再吃回來，叫「超吃」。', show: { t: 'table', trump: 0, plays: [['w', 'DA'], ['n', 'S3'], ['e', 'S7'], ['s', 'D2']], win: 'e', note: '東家用更大的王牌超吃' } },
      { say: '要注意：手上還有領出的花色，就不能王吃，一定要先跟牌。', show: text('有同花色 → 一定要跟\n沒有 → 才能王吃或墊牌') },
    ],
  },
  {
    id: 'bidding', title: '叫牌怎麼進行', steps: [
      { say: '叫牌像拍賣，從發牌的人開始，順時針輪流。每個叫品是「線位」加「花色」。一線是 7 墩，二線是 8 墩，一直到七線 13 墩。', show: { t: 'kv', rows: [['1 線', '要贏 7 墩'], ['3 線', '要贏 9 墩'], ['6 線', '要贏 12 墩（小滿貫）'], ['7 線', '要贏 13 墩（大滿貫）']] } },
      { say: '同一線裡，由低到高是梅花、方塊、紅心、黑桃、無王。下一個叫品一定要比前一個高。', show: { t: 'text', s: '1♣ < 1♦ < 1♥ < 1♠ < 1NT < 2♣ … < 7NT' } },
      { say: '不想叫就說 Pass。對手的叫品可以「賭倍」，叫 X；被賭倍的一方可以「再賭倍」，叫 XX。', show: { t: 'text', s: 'Pass（不叫）　X（賭倍）　XX（再賭倍）' } },
      { say: '有人叫牌之後，連續三家 Pass，叫牌就結束。如果四家都 Pass，這副牌重發、不計分。', show: { t: 'auction', dealer: 2, calls: ['1H', 'P', '2H', 'P', '4H', 'P', 'P', 'P'] } },
    ],
  },
  {
    id: 'contract', title: '合約與主打', steps: [
      { say: '最後一個叫品就是合約。例如 4 紅心：紅心當王牌，叫到的一方要贏 6 加 4 等於 10 墩。', show: { t: 'kv', rows: [['合約', '4♥'], ['王牌', '紅心'], ['要贏', '10 墩']] } },
      { say: '誰主打？同一隊裡，最先叫出這個花色的人就是主打。這個例子南家最先叫紅心，南家主打。', show: { t: 'auction', dealer: 2, calls: ['1H', 'P', '2H', 'P', '4H', 'P', 'P', 'P'], mark: 0 } },
      { say: '主打的左手邊，也就是下家先出第一張牌，叫「首攻」。首攻之後，主打的夥伴把牌全部攤在桌上，叫「明手」，由主打代為出牌。', show: { t: 'table', hands: { n: '明手（攤牌）', s: '主打', w: '首攻', e: '防家' } } },
    ],
  },
  {
    id: 'open', title: '開叫', steps: [
      { say: '第一個叫牌的動作叫「開叫」。大牌點 12 點以上，就可以開叫。', show: cards([{ label: '12 點，可以開叫', cards: 'SA SK S4 S3 HQ H5 H2 DJ D8 D4 CQ C7 C3' }]) },
      { say: '有五張以上的黑桃或紅心，就開叫一黑桃或一紅心，這叫「五張高花」。', show: cards([{ label: '開叫 1♠', cards: 'SA SQ S9 S7 S4 HK H5 H2 DJ D4 CQ C7 C3', hl: [0, 1, 2, 3, 4] }]) },
      { say: '牌型平均、15 到 17 點，開叫一無王。沒有五張高花時，開叫較長的低花。', show: { t: 'kv', rows: [['12～21 點＋五張高花', '1♥ 或 1♠'], ['15～17 點平均牌', '1NT'], ['20～21 點平均牌', '2NT'], ['22 點以上', '2♣（強開叫）'], ['其他 12 點以上', '1♣ 或 1♦']] } },
      { say: '點數不多，但有一門很長的牌，可以用「阻塞叫」開叫二線或三線，妨礙對手。', show: cards([{ label: '開叫 3♠（七張黑桃）', cards: 'SK SQ SJ S9 S8 S6 S2 H5 D8 D4 C9 C7 C3', hl: [0, 1, 2, 3, 4, 5, 6] }]) },
    ],
  },
  {
    id: 'respond', title: '應叫與成局', steps: [
      { say: '夥伴開叫之後，您有 6 點以上就要回應，這叫「應叫」，讓夥伴知道您也有牌。', show: { t: 'auction', dealer: 2, calls: ['1H', 'P', '1S', 'P'] } },
      { say: '打橋牌最重要的目標是「成局」：無王要 3 線、紅心黑桃要 4 線、方塊梅花要 5 線，分數會多很多。', show: { t: 'kv', rows: [['3NT', '要 9 墩'], ['4♥、4♠', '要 10 墩'], ['5♣、5♦', '要 11 墩']] } },
      { say: '兩人合計約 25 點，就可以叫到成局；33 點可以試小滿貫，37 點可以試大滿貫。', show: { t: 'kv', rows: [['25 點', '成局'], ['33 點', '小滿貫（12 墩）'], ['37 點', '大滿貫（13 墩）']] } },
      { say: '夥伴的高花和您合起來有八張以上，就找到了「配合」，優先用這門當王牌。', show: cards([{ label: '您 3 張＋夥伴 5 張＝8 張配合', cards: 'HK H9 H4 HA HQ HJ H7 H3', hl: [3, 4, 5, 6, 7] }]) },
      { say: '夥伴開叫一無王時，二梅花是問對方有沒有四張高花，叫「史帝曼」；二方塊、二紅心是「轉換叫」，表示您有五張紅心或黑桃，讓開叫者來主打。', show: { t: 'kv', rows: [['2♣', '問四張高花（史帝曼）'], ['2♦', '我有 5 張以上紅心'], ['2♥', '我有 5 張以上黑桃'], ['3NT', '有成局點力，沒有高花']] } },
    ],
  },
  {
    id: 'lead', title: '首攻與明手', steps: [
      { say: '防家的第一張牌非常重要。如果夥伴叫過牌，通常就攻夥伴叫的花色。', show: { t: 'text', s: '首攻第一選擇：夥伴叫過的花色' } },
      { say: '有連續大牌時，攻最大的一張，例如 K Q J 攻 K，既安全又能建立贏張。', show: cards([{ label: '連張攻 K', cards: 'SK SQ SJ S5', hl: [0] }]) },
      { say: '對無王合約，常攻最長一門的第四大牌，先把自己的長門做起來。', show: cards([{ label: '長門第四大：攻 5', cards: 'SK ST S8 S5 S2', hl: [3] }]) },
      { say: '明手攤開之後，主打要先停下來數一數：有幾個穩贏的墩？還缺幾墩？要怎麼補足？這就是做計畫。', show: text('① 數贏墩\n② 差幾墩\n③ 怎麼做出來') },
    ],
  },
  {
    id: 'finesse', title: '飛牌', steps: [
      { say: '「飛牌」是最常用的技巧。假設南家有黑桃 A Q，東家有 K。如果直接打 A，Q 就要輸給 K。', show: { t: 'table', trump: -1, hands: { n: '♠ 3 2', e: '♠ K 5 4', s: '♠ A Q', w: '♠ 8 7 6' } } },
      { say: '正確做法：從北家領小牌往南家打。東家如果出小牌，南家就出 Q；因為 K 坐在 A Q 前面，Q 就能贏！', show: { t: 'table', trump: -1, hands: { n: '♠ 2', e: '♠ K 5', s: '♠ A', w: '♠ 8 7' }, plays: [['n', 'S3'], ['e', 'S4'], ['s', 'SQ'], ['w', 'S6']], win: 's', note: 'Q 贏了！之後 A 也會贏' } },
      { say: '東家如果出 K，南家就用 A 吃掉，Q 就成了最大的牌。不管東家怎麼出，兩墩都是南家的。', show: { t: 'table', trump: -1, plays: [['n', 'S3'], ['e', 'SK'], ['s', 'SA'], ['w', 'S6']], win: 's', note: '東家出 K，A 吃下，Q 變最大' } },
      { say: '飛牌要朝著大牌的方向打，讓對手先表態。如果 K 在西家，飛牌就會失敗，所以飛牌的成功率大約一半。', show: text('領小牌 → 往大牌的方向打\nK 在 A Q 前面才會成功') },
    ],
  },
  {
    id: 'draw', title: '清王與立墩', steps: [
      { say: '打王牌合約時，主打通常先把對手的王牌清掉，避免自己的贏張被王吃，這叫「清王」。', show: { t: 'table', trump: 0, plays: [['s', 'SA'], ['w', 'S3'], ['n', 'S5'], ['e', 'S2']], win: 's', note: '一輪清掉東西兩張王牌' } },
      { say: '但如果明手王牌短，也可以先留著，用明手的王牌吃掉自己的輸張，這叫「將吃」。', show: { t: 'table', trump: 0, plays: [['s', 'D3'], ['w', 'D7'], ['n', 'S4'], ['e', 'D9']], win: 'n', note: '明手沒有方塊，王吃多贏一墩' } },
      { say: '「立墩」是把長門的小牌變成贏張。例如無王合約有五張方塊，對手的方塊被打光之後，最後兩張小牌就都能贏。', show: cards([{ label: '先讓出一兩墩，最後的小牌就是贏張', cards: 'DA DK D7 D5 D3', hl: [3, 4] }]) },
      { say: '防家的目標相反：攻對手的弱點、保留能控制長門的牌，並且記住每一門已經出了幾張。', show: text('數牌：每門 13 張，出了幾張？') },
    ],
  },
  {
    id: 'score', title: '計分', steps: [
      { say: '做成合約的基本分：梅花方塊每墩 20 分、紅心黑桃每墩 30 分、無王第一墩 40 分，之後每墩 30 分。', show: { t: 'kv', rows: [['♣ ♦', '每墩 20'], ['♥ ♠', '每墩 30'], ['NT', '40，之後 30']] } },
      { say: '基本分滿 100 就是成局，有獎分：沒身價 300、有身價 500。沒滿 100 只有 50 分。', show: { t: 'kv', rows: [['3NT 沒身價', scoreContract(3, 'N', 0, false, 9)], ['3NT 有身價', scoreContract(3, 'N', 0, true, 9)], ['4♠ 沒身價', scoreContract(4, 'S', 0, false, 10)], ['2♠ 沒身價', scoreContract(2, 'S', 0, false, 8)]] } },
      { say: '滿貫有更大的獎分：小滿貫沒身價再加 500、有身價加 750；大滿貫 1000 或 1500。', show: { t: 'kv', rows: [['6♠ 沒身價', scoreContract(6, 'S', 0, false, 12)], ['6♠ 有身價', scoreContract(6, 'S', 0, true, 12)], ['7NT 有身價', scoreContract(7, 'N', 0, true, 13)]] } },
      { say: '沒做到就是「倒約」，每倒一墩對手得分：沒身價 50、有身價 100，被賭倍會罰得更重。', show: { t: 'kv', rows: [['倒 1 沒身價', scoreContract(4, 'S', 0, false, 9)], ['倒 1 有身價', scoreContract(4, 'S', 0, true, 9)], ['賭倍倒 2 有身價', scoreContract(4, 'S', 1, true, 8)]] } },
      { say: '比賽時用 IMP 比較，把分數差換算成 0 到 24 的數字，避免一副大牌決定全部。本程式會算出雙方最佳的 Par 分數，對 Par 累積 IMP，打完還能逐張看哪裡少了墩。', show: text('分數差 → IMP（0～24）\n對 Par 累積') },
    ],
  },
];

export const SYS_LESSONS = [
  {
    id: 's-start', title: '開始比賽', steps: [
      { say: '首頁有三種比賽：真人對 AI、遠端真人對真人、AI 對 AI。選好難度和副數，按下開始就可以了。AI 引擎一打開程式就自動準備好，不需要另外安裝。', show: { t: 'kv', rows: [['A 真人對 AI', '您坐南家'], ['B 真人對真人', '開房間、邀朋友'], ['C AI 對 AI', '四家攤牌觀戰']] } },
      { say: '難度有入門、中級、高手、大師四級。高手以上會用模擬比較叫品，大師抽樣最多。', show: { t: 'kv', rows: [['入門', '偶爾會失誤'], ['中級', '神經網路叫牌'], ['高手', '加上模擬比較'], ['大師', '抽樣最多']] } },
    ],
  },
  {
    id: 's-profile', title: '半身照與軍師', steps: [
      { say: '第一次使用要選半身照和 AI 軍師：20 位男性、20 位女性牌手，以及 30 位男女軍師。首頁按「更換半身照與軍師」隨時可以改。', show: { t: 'kv', rows: [['男性牌手', '20 位'], ['女性牌手', '20 位'], ['AI 軍師', '30 位']] } },
    ],
  },
  {
    id: 's-bid', title: '叫牌操作', steps: [
      { say: '輪到您叫牌時，畫面中央會出現叫牌盒，叫不了的叫品會變淡。點一下就叫出去，按綠色的 Pass 就是不叫，紅色的 X 是賭倍。', show: { t: 'text', s: '1♣ 1♦ 1♥ 1♠ 1NT …\nPass　X　XX' } },
      { say: '上方的叫牌表會顯示四家叫了什麼，有身價的一家用紅色標示。', show: { t: 'auction', dealer: 0, calls: ['1S', 'P', '2S', 'P', '4S', 'P', 'P', 'P'] } },
    ],
  },
  {
    id: 's-play', title: '出牌操作', steps: [
      { say: '輪到您出牌時，上方會顯示「輪到您出牌」，能出的牌會浮起來，不能出的牌會變暗，點一下就打出。', show: text('輪到您出牌') },
      { say: '您是主打時，輪到明手也由您替明手出牌，點桌上明手的牌就可以。對方回合時會顯示「換您觀牌」。', show: text('輪到您替明手出牌') },
      { say: '滑鼠右鍵拖曳可以旋轉牌桌，滾輪可以縮放，右上角可以切換斜視、俯視、立體三種視角。', show: text('斜視　俯視　立體') },
    ],
  },
  {
    id: 's-adv', title: 'AI 軍師', steps: [
      { say: '按「提示」，軍師會把建議的牌或叫品標成亮綠色。右邊的軍師分頁可以問問題，也會告訴您夥伴大概有幾點、什麼牌型。', show: text('💡 提示') },
      { say: '按「軍師接手」，軍師就坐上主位替您比賽；想自己打時按「換回主位」。', show: text('🧙 軍師接手　🙋 換回主位') },
      { say: '比賽中按「換軍師」，可以隨時換一位軍師陪同。在設定輸入 Anthropic API 金鑰之後，軍師還會用白話解說。', show: text('🔄 換軍師') },
    ],
  },
  {
    id: 's-net', title: '遠端對賽', steps: [
      { say: '在首頁按「建立房間」會得到一組六位數房號，把房號告訴朋友，朋友按「加入房間」輸入就好。最多四位真人，空位由 AI 補上。', show: { t: 'text', s: '房號 123 456' } },
      { say: '您坐南家，第一位朋友坐對面當夥伴，房主可以按「換位」調整座位。聊天分頁可以打字，也可以按「加入語音」通話。', show: text('🎤 加入語音') },
    ],
  },
  {
    id: 's-kb', title: '牌譜庫與速算', steps: [
      { say: '每打完一副，牌譜就自動累積到牌譜庫，同時算好 20 組雙明手結果和 Par。', show: { t: 'kv', rows: [['自動累積', '每副都存'], ['雙明手', '20 組結果'], ['Par', '雙方最佳'], ['IMP', '對 Par 累積']] } },
      { say: '牌譜庫可以用合約、結果或牌手名字查詢。按「重播」一步一步看，按「逐張分析」看每一張牌有沒有少墩。也可以匯入、匯出 PBN 格式的牌譜。', show: text('查詢　重播　逐張分析　PBN') },
    ],
  },
  {
    id: 's-sys', title: '音樂與更新', steps: [
      { say: '內建 20 首背景音樂。上方的直立滑桿可以調音樂和音效的大小聲，往上是大聲。音樂分頁可以選歌，也能加入自己的音樂。', show: text('♫ 背景音樂 20 首') },
      { say: '首頁的「關於與更新」可以檢查新版本。電腦版與 Android 會下載並安裝；iPad、iPhone 會打開 GitHub 安裝頁，按一下就更新；線上版重新載入網頁就好。', show: { t: 'kv', rows: [['Windows、Mac', '下載並安裝'], ['Android', '下載 APK 安裝'], ['iPad、iPhone', 'GitHub 安裝頁'], ['線上版', '重新載入']] } },
    ],
  },
];

// 練習題：kind = choice（選答案）；answer 由規則引擎算，不是寫死
export const PRACTICE = [
  { q: '這手牌有幾個大牌點？', cards: 'SA SQ S4 HK H9 H2 DJ D8 D4 CA C7 C3 C2', kind: 'hcp' },
  { q: '這手牌有幾個大牌點？', cards: 'SK SJ S9 S2 HQ HJ H3 D7 D6 D5 CK C8 C4', kind: 'hcp' },
  { q: '無王合約，北家領牌，誰贏這一墩？', plays: [['n', 'H9'], ['e', 'HQ'], ['s', 'H4'], ['w', 'HJ']], trump: -1, kind: 'winner' },
  { q: '黑桃是王牌，西家領方塊，誰贏這一墩？', plays: [['w', 'DA'], ['n', 'D4'], ['e', 'S2'], ['s', 'D6']], trump: 0, kind: 'winner' },
  { q: '黑桃是王牌，誰贏這一墩？', plays: [['e', 'CK'], ['s', 'S3'], ['w', 'C2'], ['n', 'S6']], trump: 0, kind: 'winner' },
  { q: '合約 4♠ 要贏幾墩？', level: 4, kind: 'need' },
  { q: '合約 3NT 要贏幾墩？', level: 3, kind: 'need' },
  { q: '合約 6♦ 要贏幾墩？', level: 6, kind: 'need' },
  { q: '沒有身價，做成 3NT 剛好，得幾分？', score: [3, 'N', 0, false, 9], kind: 'score', opts: [100, 300, 400, 600] },
  { q: '有身價，做成 4♠ 剛好，得幾分？', score: [4, 'S', 0, true, 10], kind: 'score', opts: [420, 620, 650, 720] },
];

const SEAT_OF = { n: 0, e: 1, s: 2, w: 3 };

export function trickWinner(plays, trump) {
  const lead = suitOf(cardFromCode(plays[0][1]));
  let best = plays[0];
  for (const p of plays) {
    const c = cardFromCode(p[1]), b = cardFromCode(best[1]);
    if (suitOf(c) === suitOf(b)) { if (rankOf(c) < rankOf(b)) best = p; } else if (suitOf(c) === trump) best = p;
    else if (suitOf(b) !== trump && suitOf(c) === lead) best = p;
  }
  return best[0];
}

export function practiceAnswer(p) {
  if (p.kind === 'hcp') return hcpOf(C(p.cards));
  if (p.kind === 'winner') return trickWinner(p.plays, p.trump);
  if (p.kind === 'need') return p.level + 6;
  if (p.kind === 'score') return scoreContract(...p.score);
  return null;
}

let G = null;

export function openGuide(ctx) {
  const root = $('#guideBody');
  root.innerHTML = '';
  G = { ctx, section: ctx.section || 'teach', li: 0, si: 0, playing: false, token: 0, practice: false, pi: 0 };
  G.stage = h('div', { class: 'gd-stage' });
  G.caption = h('div', { class: 'gd-caption' });
  G.list = h('div', { class: 'gd-list' });
  G.ctrl = h('div', { class: 'gd-ctrl' },
    h('button', { onclick: () => { stopPlay(); step(-1); } }, '◀ 上一步'),
    h('button', { class: 'primary', id: 'gdPlay', onclick: () => togglePlay() }, '▶ 播放講解'),
    h('button', { onclick: () => { stopPlay(); step(1); } }, '下一步 ▶'));
  G.secBtns = h('div', { class: 'gd-section' },
    h('button', { 'data-s': 'teach', onclick: () => setSection('teach') }, '🎓 橋牌教學'),
    h('button', { 'data-s': 'system', onclick: () => setSection('system') }, '📖 系統說明'));
  root.append(
    h('div', { class: 'gd-head' }, h('h2', {}, '橋牌教學與系統說明'), G.secBtns, h('span', { class: 'muted small' }, ctx.voice.available ? `語音：${ctx.voice.voiceName}` : '這台電腦沒有中文語音，改用文字'),
      h('button', { class: 'gd-back', onclick: () => { stopPlay(); ctx.back(); } }, '⟵ 回首頁')),
    h('div', { class: 'gd-body' }, G.list, h('div', { class: 'gd-main' }, G.stage, h('div', { class: 'gd-side' }, G.caption, G.ctrl))));
  ctx.show();
  setSection(G.section);
  startPlay();
}

const lessons = () => (G.section === 'system' ? SYS_LESSONS : LESSONS);

function setSection(s) {
  stopPlay();
  G.section = s;
  G.li = 0; G.si = 0; G.practice = false;
  $$('button', G.secBtns).forEach((b) => b.classList.toggle('on', b.dataset.s === s));
  G.list.innerHTML = '';
  lessons().forEach((l, i) => G.list.append(h('button', { class: 'gd-item' + (i === 0 ? ' on' : ''), 'data-i': i, onclick: () => goLesson(i) }, h('span', { class: 'n' }, i + 1), l.title)));
  if (s === 'teach') G.list.append(h('button', { class: 'gd-item practice', 'data-i': 'p', onclick: () => openPractice(0) }, h('span', { class: 'n' }, '✎'), '練習題'));
  renderStep();
}

function goLesson(i) {
  stopPlay();
  G.li = i; G.si = 0; G.practice = false;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === String(i)));
  renderStep();
  startPlay();
}

function handBox(pos, value) {
  const who = { n: '北', e: '東', s: '南', w: '西' }[pos];
  return h('div', { class: `gs-hand ${pos}` }, h('div', { class: 'who' }, who), h('div', { class: 'row' }, value || ''));
}

const TRICK_POS = { n: [0, -62], e: [66, 0], s: [0, 62], w: [-66, 0] };

function renderTable(show, token) {
  const box = h('div', { class: 'gs-table' });
  for (const p of ['n', 'e', 's', 'w']) box.append(handBox(p, show.hands ? show.hands[p] : ''));
  const center = h('div', { class: 'gs-trick' });
  box.append(center);
  G.stage.append(box);
  if (!show.plays) return;
  const sc = () => Math.max(0.7, Math.min(1.5, (box.clientWidth || 500) / 420));
  show.plays.forEach(([seat, code], i) => {
    setTimeout(() => {
      if (token !== G.renderToken) return;
      const [x, y] = TRICK_POS[seat];
      const img = h('img', { class: `gs-card fly-${seat}`, src: cardUrl(cardFromCode(code)), alt: cardName(cardFromCode(code)), style: { left: `${x * sc()}px`, top: `${y * sc()}px` } });
      img.dataset.seat = seat;
      center.append(img);
    }, 500 + i * 750);
  });
  if (show.win) {
    setTimeout(() => {
      if (token !== G.renderToken) return;
      const w = [...center.children].find((c) => c.dataset.seat === show.win);
      if (w) w.classList.add('gs-win');
      if (show.note) box.append(h('div', { class: 'gs-note' }, show.note));
    }, 500 + show.plays.length * 750 + 200);
  }
}

function renderCards(show) {
  for (const r of show.rows) {
    const list = C(r.cards);
    G.stage.append(h('div', { class: 'gd-row' }, r.label ? h('div', { class: 'gd-label' }, r.label) : null,
      h('div', { class: 'gs-row' }, list.map((c, i) => {
        const img = h('img', { src: cardUrl(c), alt: cardName(c), class: (r.hl || []).includes(i) ? 'hl' : (r.dim || []).includes(i) ? 'dim' : '' });
        img.style.animationDelay = `${i * 40}ms`;
        return img;
      }))));
  }
}

function renderAuction(show) {
  const cols = [3, 0, 1, 2];
  const cells = [];
  for (let i = 0; i < cols.indexOf(show.dealer); i++) cells.push(null);
  show.calls.forEach((c, i) => cells.push({ c, i }));
  const rows = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4));
  G.stage.append(h('div', { class: 'gs-auction' }, h('table', {},
    h('tr', {}, cols.map((s) => h('th', {}, SEATS[s]))),
    rows.map((r) => h('tr', {}, [0, 1, 2, 3].map((j) => {
      const e = r[j];
      if (!e) return h('td', {}, '');
      return h('td', { class: 'new', style: { animationDelay: `${e.i * 180}ms` } }, callName(e.c));
    }))))));
}

function renderStep() {
  G.renderToken = (G.renderToken || 0) + 1;
  const L = lessons()[G.li];
  const st = L.steps[G.si];
  G.caption.className = 'gd-caption';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `${L.title}　${G.si + 1} / ${L.steps.length}`), h('div', {}, st.say));
  G.stage.innerHTML = '';
  const show = st.show || {};
  if (show.t === 'table') renderTable(show, G.renderToken);
  else if (show.t === 'cards') renderCards(show);
  else if (show.t === 'auction') renderAuction(show);
  else if (show.t === 'kv') G.stage.append(h('div', { class: 'gs-kv' }, show.rows.flatMap(([k, v]) => [h('div', {}, k), h('b', {}, String(v))])));
  else if (show.t === 'text') G.stage.append(h('div', { class: 'gs-text', style: { whiteSpace: 'pre-line' } }, show.s));
}

function step(d) {
  const ls = lessons(), L = ls[G.li];
  let si = G.si + d, li = G.li;
  if (si >= L.steps.length) { if (li + 1 >= ls.length) { if (G.section === 'teach') openPractice(0); return false; } li++; si = 0; }
  if (si < 0) { if (li === 0) return false; li--; si = ls[li].steps.length - 1; }
  G.li = li; G.si = si;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === String(li)));
  renderStep();
  return true;
}

function startPlay() { if (G && !G.playing) togglePlay(); }

// 語音要把符號念成中文
export function speechText(s) {
  return String(s).replace(/♠/g, '黑桃').replace(/♥/g, '紅心').replace(/♦/g, '方塊').replace(/♣/g, '梅花').replace(/NT/g, '無王').replace(/3NT/g, '三無王');
}

async function togglePlay() {
  if (G.playing) { stopPlay(); return; }
  G.playing = true;
  const token = ++G.token;
  const b = $('#gdPlay');
  if (b) b.textContent = '⏸ 暫停';
  for (;;) {
    const st = lessons()[G.li].steps[G.si];
    G.caption.classList.add('speaking');
    await G.ctx.voice.speak(speechText(st.say));
    G.caption.classList.remove('speaking');
    if (token !== G.token || !G.playing) return;
    await new Promise((r) => setTimeout(r, 700));
    if (token !== G.token || !G.playing) return;
    const ls = lessons();
    const lastOfLesson = G.si === ls[G.li].steps.length - 1;
    if (lastOfLesson && G.li === ls.length - 1) { stopPlay(); toast(G.section === 'teach' ? '全部講完了，來做練習題吧！' : '系統說明講完了', 'ok'); return; }
    step(1); // 一課講完自動接下一課
  }
}

function stopPlay() {
  if (!G) return;
  G.playing = false;
  G.token++;
  G.ctx.voice.stop();
  const b = $('#gdPlay');
  if (b) b.textContent = '▶ 播放講解';
}

function openPractice(i) {
  stopPlay();
  G.practice = true;
  G.pi = (i + PRACTICE.length) % PRACTICE.length;
  G.renderToken = (G.renderToken || 0) + 1;
  $$('.gd-item', G.list).forEach((b) => b.classList.toggle('on', b.dataset.i === 'p'));
  const p = PRACTICE[G.pi];
  const answer = practiceAnswer(p);
  G.caption.className = 'gd-caption practice';
  G.caption.innerHTML = '';
  G.caption.append(h('div', { class: 'gd-step muted small' }, `練習題 ${G.pi + 1} / ${PRACTICE.length}`), h('div', {}, p.q));
  G.stage.innerHTML = '';
  const result = h('div', { class: 'gd-result' });
  const check = (ok, msg) => {
    result.className = 'gd-result ' + (ok ? 'ok' : 'bad');
    result.textContent = msg;
    G.ctx.voice.stop();
    G.ctx.voice.speak(ok ? '答對了！' : '再想想看。');
  };
  let opts = [];
  if (p.kind === 'hcp') {
    renderCards({ rows: [{ cards: p.cards }] });
    opts = [answer - 2, answer - 1, answer, answer + 1, answer + 2].map((n) => [n, `${n} 點`]);
  } else if (p.kind === 'winner') {
    renderTable({ plays: p.plays, trump: p.trump }, G.renderToken);
    opts = ['n', 'e', 's', 'w'].map((x) => [x, `${SEATS[SEAT_OF[x]]}家`]);
  } else if (p.kind === 'need') {
    G.stage.append(h('div', { class: 'gs-text' }, p.q));
    opts = [7, 8, 9, 10, 11, 12, 13].map((n) => [n, `${n} 墩`]);
  } else if (p.kind === 'score') {
    G.stage.append(h('div', { class: 'gs-text' }, p.q));
    opts = p.opts.map((n) => [n, `${n} 分`]);
  }
  G.stage.append(h('div', { class: 'gd-choices' }, opts.map(([v, l]) => h('button', { 'data-v': v, onclick: () => check(v === answer, v === answer ? `答對了！答案是 ${l}。` : `不對喔，再想想看。`) }, l))), result);
  G.stage.append(h('div', { class: 'gd-ctrl' }, h('button', { onclick: () => openPractice(G.pi - 1) }, '◀ 上一題'), h('button', { class: 'primary', onclick: () => openPractice(G.pi + 1) }, '下一題 ▶')));
  G.ctx.voice.stop();
  G.ctx.voice.speak(speechText(p.q));
}

export { sideOf, RANKS, STRAIN_SYM };
