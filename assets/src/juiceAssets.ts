// JuiceAssets.ts
import { resources, SpriteFrame } from 'cc';

// 固定可用的系列键（按需扩展）
const SERIES_KEYS = ['juice_l', 'juice_o', 'juice_q'] as const;
type SeriesKey = typeof SERIES_KEYS[number];
type Style = 'classic' | 'minimal' | 'slashOnly';

// 例如 { juice_l: 10, juice_o: 10, juice_q: 10 }
type PreloadPlan = Partial<Record<SeriesKey, number>>;

export class JuiceAssets {
  private static _inst: JuiceAssets | null = null;
  static get I() {
    if (!this._inst) this._inst = new JuiceAssets();
    return this._inst;
  }

  private cache = new Map<string, SpriteFrame>();             // 'juice_l_7' -> sf
  private inflight = new Map<string, Promise<SpriteFrame>>(); // 正在加载的任务（避免并发重复）
  private ready = false;

  /** 开局批量预载：例如 { juice_l: 10, juice_o: 10, juice_q: 10 } */
  async preload(plan: PreloadPlan): Promise<void> {
    const tasks: Promise<void>[] = [];
    // 不用 Object.entries，直接按白名单系列遍历
    for (let i = 0; i < SERIES_KEYS.length; i++) {
      const series = SERIES_KEYS[i];
      const count = plan[series];
      if (typeof count === 'number' && count > 0) {
        tasks.push(this.preloadSeries(series, count));
      }
    }
    await Promise.all(tasks);

    this.ready = true;

    // 打印缓存 key（避免 Array.from / 展开运算）
    const keys: string[] = [];
    this.cache.forEach((_v, k) => keys.push(k));
    console.log('[JuiceAssets] preload done:', keys);
  }

  /** 预载某系列：juice_l + count=10 => juice_l_1..10 */
  async preloadSeries(series: SeriesKey, count: number): Promise<void> {
    const names: string[] = [];
    for (let i = 1; i <= count; i++) names.push(series + '_' + i);

    const results = await Promise.all(names.map((n) => this.loadKey(n)));
    for (let i = 0; i < names.length; i++) {
      this.cache.set(names[i], results[i]);
    }
    console.log('[JuiceAssets] series loaded:', series, 'x' + count);
  }

  /** 获取：若未缓存则惰性加载并缓存 */
  async get(key: string): Promise<SpriteFrame> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const sf = await this.loadKey(key);
    this.cache.set(key, sf);
    return sf;
  }

  /** 按系列+编号获取（1-based） */
  async getSeries(series: SeriesKey, index: number): Promise<SpriteFrame> {
    return this.get(series + '_' + index);
  }

  /** 同步尝试获取（只在已经缓存过时可用） */
  tryGetSync(key: string): SpriteFrame | null {
    const v = this.cache.get(key);
    return v ? v : null;
  }

  /** 根据 tier（0..10）映射到系列与编号（可按项目改规则） */
  async getByTier(tier: number, kind: SeriesKey = 'juice_l'): Promise<SpriteFrame> {
    let idx = tier + 1; // 例：tier=0 -> 1
    if (idx < 1) idx = 1;
    if (idx > 10) idx = 10;
    return this.getSeries(kind, idx);
  }

  /** 根据风格返回一套贴图（可自定义映射策略） */
  async getSetByStyle(style: Style): Promise<{ particle: SpriteFrame; circle: SpriteFrame; slash: SpriteFrame }> {
    // 你可以替换为按 tier/随机/权重等策略
    const map: { [k in Style]: [string, string, string] } = {
      classic:   ['juice_l_4', 'juice_o_5', 'juice_q_6'],
      minimal:   ['juice_l_2', 'juice_o_2', 'juice_q_2'],
      slashOnly: ['juice_l_3', 'juice_o_3', 'juice_q_7'],
    };
    const keys = map[style];
    const particle = await this.get(keys[0]);
    const circle   = await this.get(keys[1]);
    const slash    = await this.get(keys[2]);
    return { particle, circle, slash };
  }

  /** 内部：加载单个 key（回调式 API -> Promise 封装 + in-flight 去重） */
  private loadKey(key: string): Promise<SpriteFrame> {
    // 命中缓存
    const c = this.cache.get(key);
    if (c) return Promise.resolve(c);

    // 正在加载
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;

    const path = 'juice/' + key + '/spriteFrame'; // 例如 assets/resources/juice/juice_l_1.png
    const p = new Promise<SpriteFrame>((resolve, reject) => {
      resources.load(path, SpriteFrame, (err, sf) => {
        this.inflight.delete(key);
        if (err || !sf) {
          console.error('[JuiceAssets] load failed:', key, err);
          reject(err || new Error('load failed: ' + key));
          return;
        }
        resolve(sf);
      });
    });

    this.inflight.set(key, p);
    return p;
  }

  /** 是否已做过预载（仅状态标记，不阻止惰性加载） */
  isReady(): boolean { return this.ready; }
}
