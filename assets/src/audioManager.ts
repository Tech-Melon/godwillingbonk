// AudioManager.ts
import { _decorator, Component, AudioSource, AudioClip, clamp, Node as CNode } from 'cc';
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

    @property({ tooltip: '合成音效尾部淡出毫秒数' }) mergeFadeOutMs = 20;
    @property({ tooltip: '合成音效基础增益（避免叠加削波）' }) mergeGain = 0.8;
    @property({ tooltip: '同一时间最多并发的合成音效个数' }) maxConcurrentMerges = 4;

    // ✅ 必须用 Cocos 的 Node 类型
    private _activeMergePlayers: CNode[] = [];

    onLoad() {
        AudioManager._instance = this;
    }

    start() {
        if (this.bgm) {
            this.bgmSource.clip = this.bgm;
            this.bgmSource.loop = true;
            this.bgmSource.play();
        }
    }

    // === 音量控制（0~1）===
    setBgmVolume(v: number) { this.bgmSource.volume = clamp(v, 0, 1); }
    setSfxVolume(v: number) { this.sfxSource.volume = clamp(v, 0, 1); }

    // === 播放：落地音效 ===
    playLand(intensity: number = 1) {
        if (!this.landClip) return;
        const vol = clamp(intensity, 0, 1);
        this.sfxSource.playOneShot(this.landClip, vol);
    }

    // === 播放：合成音效（带尾部淡出与并发限制） ===
    playMerge(tier: number) {
        if (this.mergeClips.length === 0) return;
        const idx = Math.min(Math.max(tier, 0), this.mergeClips.length - 1);
        const clip = this.mergeClips[idx];
        if (!clip) return;

        // 并发限制，避免堆叠导致削波
        if (this._activeMergePlayers.length >= this.maxConcurrentMerges) {
            const old = this._activeMergePlayers.shift();
            if (old && old.isValid) old.destroy();
        }

        this._playClipWithTailFade(clip, this.mergeGain, this.mergeFadeOutMs);
    }

    private _playClipWithTailFade(clip: AudioClip, gain: number, fadeMs: number) {
        // ✅ 使用 Cocos 的 Node（别名 CNode）
        const n = new CNode();
        n.name = 'SFX_Merge_Temp';
        this.node.addChild(n);

        const src = n.addComponent(AudioSource);
        src.loop = false;
        src.clip = clip;
        src.volume = Math.min(Math.max(gain, 0), 1);

        this._activeMergePlayers.push(n);
        src.play();

        // 兼容不同版本：优先用 getDuration()
        const dur = (clip as any).getDuration ? (clip as any).getDuration() : ((clip as any).duration ?? 0);
        const fadeSec = Math.max(0, fadeMs) / 1000;
        const startFadeAt = Math.max(0, dur - fadeSec);

        // 到尾声开始做极短淡出，再销毁
        this.scheduleOnce(() => {
            if (!src.playing) {
                const i = this._activeMergePlayers.indexOf(n);
                if (i >= 0) this._activeMergePlayers.splice(i, 1);
                n.destroy();
                return;
            }

            const v0 = src.volume;
            const t0 = performance.now();
            const T = Math.max(0.005, fadeSec) * 1000;

            const step = () => {
                const t = (performance.now() - t0) / T;
                if (t >= 1 || !src.playing) {
                    src.volume = 0;
                    src.stop();
                    const i = this._activeMergePlayers.indexOf(n);
                    if (i >= 0) this._activeMergePlayers.splice(i, 1);
                    n.destroy();
                    return;
                }
                src.volume = v0 * (1 - t);
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }, startFadeAt || 0.01);

        // 保险销毁（防止某些平台拿不到 duration）
        this.scheduleOnce(() => {
            if (n && n.isValid) {
                const i = this._activeMergePlayers.indexOf(n);
                if (i >= 0) this._activeMergePlayers.splice(i, 1);
                n.destroy();
            }
        }, (dur || 1.0) + 0.5);
    }
}
