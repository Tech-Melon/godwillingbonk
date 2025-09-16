// AudioManager.ts
import { _decorator, Component, AudioSource, AudioClip, clamp, Node as CNode, sys } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('AudioManager')
export class AudioManager extends Component {
    private static _instance: AudioManager;
    public static get I() { return this._instance; }

    @property(AudioSource) bgmSource: AudioSource = null!;
    @property(AudioSource) sfxSource: AudioSource = null!;

    @property({ type: AudioClip }) bgm: AudioClip | null = null;
    @property({ type: AudioClip, tooltip: '落地音效（单个）' }) landClip: AudioClip | null = null;
    @property({ type: [AudioClip], tooltip: '合成音效，不同等级对应不同音效' }) mergeClips: AudioClip[] = [];

    // ==== 新增：BGM 开关状态（持久化）====
    private _bgmOn = true;
    private readonly KEY_BGM_ON = 'bgmOn';

    onLoad() {
        AudioManager._instance = this;
        // 读取玩家上次设置
        const saved = sys.localStorage.getItem(this.KEY_BGM_ON);
        if (saved !== null) this._bgmOn = saved === '1';
    }

    start() {
        // 初始化并按状态决定是否播放
        if (this.bgmSource && this.bgm) {
            this.bgmSource.clip = this.bgm;
            this.bgmSource.loop = true;
            if (this._bgmOn) this.bgmSource.play();
        }
    }

    // ==== 新增：BGM 对外接口 ====
    get isBgmOn(): boolean { return this._bgmOn; }
    setBgmOn(on: boolean) {
        this._bgmOn = on;
        sys.localStorage.setItem(this.KEY_BGM_ON, on ? '1' : '0');

        if (!this.bgmSource) return;

        if (on) {
            if (!this.bgmSource.clip && this.bgm) this.bgmSource.clip = this.bgm;
            this.bgmSource.loop = true;
            this.bgmSource.play();   // 再次 play 安全，重复调用也行
        } else {
            this.bgmSource.pause();  // 用 pause 以便下次恢复从当前位置继续
        }
    }

    toggleBGM(): boolean {
        this.setBgmOn(!this._bgmOn);
        return this._bgmOn;
    }
    // === 音量控制（0~1）===
    setBgmVolume(v: number) { this.bgmSource.volume = clamp(v, 0, 1); }
    setSfxVolume(v: number) { this.sfxSource.volume = clamp(v, 0, 1); }

    // === 播放：落地音效 ===
    playLand(intensity: number = 1) {
        // console.log('playLand', intensity);
        if (!this.landClip) return;
        const vol = clamp(intensity, 0, 1);
        this.sfxSource.playOneShot(this.landClip, vol);
    }

    // === 播放：合成音效（带尾部淡出与并发限制） ===
    playMerge(tier: number, intensity: number = 1) {
        if (this.mergeClips.length === 0) return;
        const idx = Math.min(Math.max(tier, 0), this.mergeClips.length - 1);
        const clip = this.mergeClips[idx];
        if (!clip) return;
        const vol = clamp(intensity, 0, 1);
        this.sfxSource.playOneShot(clip, vol);
    }
}
