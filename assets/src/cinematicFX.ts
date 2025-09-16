// CinematicFX.ts
import {
    _decorator, Component, Node, UITransform, Vec3,
    VideoPlayer, VideoClip, UIOpacity, tween, Color,
    Canvas, director, Sprite, BlockInputEvents, resources
} from 'cc';
import { AudioManager } from './audioManager';
import { ImageAsset, Texture2D, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('CinematicFX')
export class CinematicFX extends Component {
    private static _I: CinematicFX | null = null;
    public static get I() { return this._I!; }

    // ── 配置 ──────────────────────────────────────────────
    @property({ tooltip: '是否只在高阶（如 tier>=8）时播放' }) onlyHighTier = true;
    @property({ tooltip: '播放门槛（包含）' }) minTierToPlay = 8;

    @property({ tooltip: '视频显示目标尺寸（像素）' }) targetSize: Vec3 = new Vec3(640, 720, 0);

    @property({ tooltip: '播放视频时压暗背景' }) dimWhileVideo = true;
    @property({ tooltip: '遮罩不透明度(0-255)' }) dimOpacity = 180;
    @property({ tooltip: '遮罩淡入/淡出时长(ms)' }) dimFadeMs = 150;
    @property({ tooltip: '遮罩是否拦截点击' }) dimBlocksInput = false;

    @property({ tooltip: '视频是否拦截输入（Web可关闭以透传）' }) videoBlocksInput = true;
    @property({ tooltip: '启动看门狗(ms)：起播失败判超时' }) videoStartupTimeoutMs = 1500;
    @property({ tooltip: '进度卡死超时(ms)' }) videoStallTimeoutMs = 1200;
    @property({ tooltip: '认为进度推进的最小秒数' }) videoMinProgressDelta = 0.05;
    @property({ tooltip: '拿不到真实时长时的兜底最大等待(ms)' }) videoMaxWaitMs = 12000;
    @property({ tooltip: '拿到真实时长后附加余量(ms)' }) videoFinishSlackMs = 200;
    @property({ tooltip: '视频播放健康超时(ms)' }) videoHealthTimeoutMs = 30000;

    @property({ tooltip: '视频播放队列最大长度（超过丢弃最早一条）' }) maxVideoQueue = 8;
    @property({ type: [String], tooltip: 'tier -> 本地资源key或URL' }) videoSourcesByTier: string[] = [];
    @property({ tooltip: '外置SFX音量(0~1)' }) videoSfxVolume = 1.0;

    // ── 内部状态 ──────────────────────────────────────────
    private _videoQueue: number[] = [];
    private _videoLastStartAt = 0;
    private _pumpRunning = false;
    private _pumpToken = 0;

    // 变暗管理（单例 + 引用计数）
    private _dimRef = 0;
    private _dimGroup: Node | null = null;
    private _dimOp: UIOpacity | null = null;
    private static _solidSF: SpriteFrame | null = null;

    onLoad() { CinematicFX._I = this; }
    onDestroy() {
        if (CinematicFX._I === this) CinematicFX._I = null;
        this._videoQueue.length = 0;
        if (this._dimGroup?.isValid) this._dimGroup.destroy();
        this._dimGroup = null; this._dimOp = null; this._dimRef = 0;
    }

    // ── 对外 API ──────────────────────────────────────────
    public hasVideoForTier(tier: number): boolean {
        if (this.onlyHighTier && tier < this.minTierToPlay) return false;
        return !!this._pickSourceForTier(tier);
    }

    public enqueueVideoForTier(tier: number): void {
        if (this.onlyHighTier && tier < this.minTierToPlay) return;
        if (this._videoQueue.length >= this.maxVideoQueue) this._videoQueue.shift();
        this._videoQueue.push(tier);
        if (!this._pumpRunning) this._pumpVideoQueue();
    }

    private async _pumpVideoQueue() {
        if (this._pumpRunning) return;
        this._pumpRunning = true;
        const myToken = ++this._pumpToken;
        try {
            while (true) {
                if (myToken !== this._pumpToken) return; // 废弃旧泵
                const tier = this._videoQueue.shift();
                if (tier == null) break;
                await this._playTierVideo(tier);
            }
        } catch (e) {
            console.warn('[CinematicFX] pump error:', e);
        } finally {
            this._pumpRunning = false;
            if (this._videoQueue.length > 0) this._pumpVideoQueue();
        }
    }

    // ── 单条播放 ──────────────────────────────────────────
    private _pickSourceForTier(tier: number): string | null {
        if (!this.videoSourcesByTier?.length) return null;
        let src = this.videoSourcesByTier[tier];
        if (!src) for (let i = this.videoSourcesByTier.length - 1; i >= 0; i--) {
            if (this.videoSourcesByTier[i]) { src = this.videoSourcesByTier[i]; break; }
        }
        return src ?? null;
    }

    private _kickstartHtmlVideo(vp: VideoPlayer) {
        let tries = 0;
        const tick = () => {
            try {
                const impl = (vp as any)?._impl;
                const el: HTMLVideoElement | undefined = impl?._video || impl?._dom || impl?._element;
                if (!el) { if (tries++ < 10) setTimeout(tick, 60); return; }
                el.muted = true; el.autoplay = true; el.playsInline = true;
                el.setAttribute?.('playsinline', 'true'); el.setAttribute?.('webkit-playsinline', 'true');
                el.controls = false; el.preload = el.preload || 'auto';
                if (!el.crossOrigin) { try { el.crossOrigin = 'anonymous'; } catch { } }
                (el as any).play?.();
                const t = Number(el.currentTime || 0);
                if (t < 0.01 && tries++ < 10) setTimeout(tick, 80);
            } catch { }
        };
        tick();
    }

    private async _playTierVideo(tier: number): Promise<void> {
        return new Promise<void>(async (resolve) => {
            try {
                const src = this._pickSourceForTier(tier);
                if (!src) { resolve(); return; }

                await this._withDimmer(this.dimWhileVideo, async () => {
                    // 容器
                    const node = new Node(`CinematicVideo_t${tier}`);
                    const ui = node.addComponent(UITransform);
                    ui.setAnchorPoint(0.5, 0.5);
                    ui.setContentSize(this.targetSize.x, this.targetSize.y);
                    node.setPosition(0, 0, 0);
                    node.layer = this.node.layer;
                    if (!this.isValid) { node.destroy(); resolve(); return; }
                    this.node.addChild(node);

                    // 确保黑幕在顶层，其次是视频
                    if (this._dimGroup?.isValid) this._dimGroup.setSiblingIndex(this.node.children.length - 1);
                    node.setSiblingIndex(this.node.children.length - 1);

                    // VideoPlayer
                    const vp = node.addComponent(VideoPlayer);
                    vp.loop = false; vp.mute = true; vp.keepAspectRatio = true;
                    const vop = node.addComponent(UIOpacity);
                    vop.opacity = 0;

                    const applyRect = () => {
                        const u = vp.node.getComponent(UITransform)!;
                        u.setContentSize(this.targetSize.x, this.targetSize.y);
                        (vp as any)._forceUpdateRenderArea?.(true);
                    };
                    vp.node.on(VideoPlayer.EventType.READY_TO_PLAY, applyRect, this);

                    // 资源
                    if (/^https?:\/\//i.test(src)) { vp.resourceType = VideoPlayer.ResourceType.REMOTE; vp.remoteURL = src; }
                    else {
                        const clip = await this._loadVideoClip(src);
                        if (!clip) { node.destroy(); resolve(); return; }
                        vp.resourceType = VideoPlayer.ResourceType.LOCAL; vp.clip = clip;
                    }

                    // 显式 load 一次（部分内核切源不拉流）
                    try {
                        const impl = (vp as any)?._impl;
                        const el: HTMLVideoElement | undefined = impl?._video || impl?._dom || impl?._element;
                        el?.load?.();
                    } catch { }

                    // SFX
                    const onVPPlaying = () => {
                        this._videoLastStartAt = performance.now();
                        try { AudioManager.I?.playMerge(tier, this.videoSfxVolume); } catch { }
                        vp.node.off(VideoPlayer.EventType.PLAYING, onVPPlaying, this);
                    };
                    vp.node.on(VideoPlayer.EventType.PLAYING, onVPPlaying, this);

                    let domEl: HTMLVideoElement | null = null;
                    const bindDomEl = () => {
                        if (domEl) return domEl;
                        try {
                            const impl = (vp as any)?._impl;
                            domEl = impl?._video || impl?._dom || impl?._element || null;
                            if (domEl) {
                                // 先预防性设置，避免默认 300x150 的闪烁
                                domEl.preload = domEl.preload || 'metadata';
                                domEl.muted = true; domEl.autoplay = true; domEl.playsInline = true;
                                domEl.setAttribute?.('playsinline', 'true');
                                domEl.setAttribute?.('webkit-playsinline', 'true');
                                (domEl as any).controls = false;
                                // 先锁一次矩形（即便没拿到真实尺寸，也先用 target 占位）
                                this._lockVideoSize(vp, domEl);
                            }
                        } catch { }
                        return domEl;
                    };
                    // 当进入 playing/loadedmetadata/第一次 timeupdate 后，等待尺寸稳定 → 淡入
                    const fadeInAfterStable = async () => {
                        const el = bindDomEl();
                        if (!el) { this._fade(vop, 255, 120); return; } // 拿不到 DOM，直接淡入兜底
                        try {
                            await this._waitStableSize(vp, el, 900);
                        } finally {
                            this._fade(vop, 255, 120); // 稳定后淡入
                        }
                    };
                    vp.node.once(VideoPlayer.EventType.PLAYING, () => fadeInAfterStable(), this);
                    vp.node.once(VideoPlayer.EventType.READY_TO_PLAY, () => fadeInAfterStable(), this);
                    // 再加一个兜底：若 200ms 内还没任何状态，也拉一遍
                    setTimeout(() => fadeInAfterStable(), 200);
                    // 开播
                    applyRect();
                    this._tuneHtmlVideo(vp);
                    this._setVideoPointerEvents(vp, this.videoBlocksInput);
                    this._videoLastStartAt = performance.now();

                    let played = false;
                    const tryPlay = () => {
                        if (played) return;
                        played = true;
                        try { vp.play(); } catch { }
                        this._kickstartHtmlVideo(vp);
                    };
                    vp.node.once(VideoPlayer.EventType.READY_TO_PLAY, () => tryPlay(), this);
                    setTimeout(() => tryPlay(), 0);
                    setTimeout(() => tryPlay(), 100);

                    // 等结束
                    await this._waitVideoEnd(vp);

                    // 收尾
                    vp.node.off(VideoPlayer.EventType.PLAYING, onVPPlaying, this);
                    vp.node.off(VideoPlayer.EventType.READY_TO_PLAY, applyRect, this);
                    node.destroy();
                });

                resolve();
            } catch (e) {
                console.warn('[CinematicFX] _playTierVideo error:', e);
                resolve();
            }
        });
    }

    // ── 等待结束（简化版） ───────────────────────────────────
    private _waitVideoEnd(vp: VideoPlayer): Promise<void> {
        return new Promise<void>((resolve) => {
            let cleanup: () => void = () => { };
            let done = false;
            const safeResolve = (reason = 'unknown') => {
                if (done) return;
                done = true;
                try { cleanup(); } catch { }
                resolve();
            };

            let started = false;
            let lastT = 0;
            let lastChange = performance.now();
            const startAt = performance.now();

            let fallbackTimer: any = setTimeout(() => safeResolve('max-wait'), this.videoMaxWaitMs);

            const tryBindDom = (): HTMLVideoElement | null => {
                try {
                    const impl = (vp as any)?._impl;
                    const el: HTMLVideoElement | undefined = impl?._video || impl?._dom || impl?._element;
                    if (!el) return null;

                    const considerEnded = (e: HTMLVideoElement) => {
                        const t = Number(e.currentTime || 0);
                        const dur = Number(e.duration || 0);
                        if (isFinite(dur) && dur > 0 && t >= dur - 0.2) return true;
                        if ((e as any).ended === true) return true;
                        if (e.paused && !e.seeking && e.readyState >= 3 && isFinite(dur) && dur > 0 && t > 0 && t >= dur - 0.2) return true;
                        return false;
                    };

                    const onLoadedMeta = () => {
                        const durSec = Number(el.duration);
                        if (isFinite(durSec) && durSec > 0) {
                            clearTimeout(fallbackTimer);
                            fallbackTimer = setTimeout(() => safeResolve('real-duration-timeout'), durSec * 1000 + this.videoFinishSlackMs);
                        }
                    };
                    const onTimeUpdate = () => {
                        const now = performance.now();
                        const t = Number(el.currentTime || 0);
                        if (considerEnded(el)) { safeResolve('ended'); return; }
                        if (t - lastT > Math.max(0.02, this.videoMinProgressDelta * 0.5)) { lastT = t; lastChange = now; this._videoLastStartAt = now; }
                        else if (now - lastChange > Math.max(1800, this.videoStallTimeoutMs)) {
                            if (considerEnded(el)) safeResolve('stall-near-end'); else safeResolve('stall');
                        }
                    };
                    const onPlaying = () => {
                        started = true;
                        this._videoLastStartAt = performance.now();
                        onLoadedMeta(); // 有时 playing 时 duration 已可用
                    };
                    const onPause = () => {
                        const t = Number(el.currentTime || 0), dur = Number(el.duration || 0);
                        if (isFinite(dur) && dur > 0 && t >= dur - 0.2) safeResolve('pause-near-end');
                    };

                    el.preload = el.preload || 'auto';
                    if (!el.crossOrigin) { try { el.crossOrigin = 'anonymous'; } catch { } }

                    el.addEventListener('loadedmetadata', onLoadedMeta);
                    el.addEventListener('timeupdate', onTimeUpdate);
                    el.addEventListener('playing', onPlaying);
                    el.addEventListener('pause', onPause);
                    el.addEventListener('ended', () => safeResolve('dom-ended'));
                    el.addEventListener('error', () => safeResolve('dom-error'));

                    domUnbinders.push(() => {
                        el.removeEventListener('loadedmetadata', onLoadedMeta);
                        el.removeEventListener('timeupdate', onTimeUpdate);
                        el.removeEventListener('playing', onPlaying);
                        el.removeEventListener('pause', onPause);
                        el.removeEventListener('ended', () => safeResolve('dom-ended'));
                        el.removeEventListener('error', () => safeResolve('dom-error'));
                    });

                    return el;
                } catch { return null; }
            };

            const domUnbinders: Array<() => void> = [];
            let boundEl: HTMLVideoElement | null = tryBindDom();

            // 组件事件（用来补绑 DOM）
            const onReady = () => { if (!boundEl) boundEl = tryBindDom(); };
            const onPlaying = () => { started = true; if (!boundEl) boundEl = tryBindDom(); };
            const onFinish = () => safeResolve('component-finish');
            const onError = () => safeResolve('component-error');

            vp.node.on(VideoPlayer.EventType.READY_TO_PLAY, onReady, this);
            vp.node.on(VideoPlayer.EventType.PLAYING, onPlaying, this);
            vp.node.on(VideoPlayer.EventType.COMPLETED, onFinish, this);
            vp.node.on(VideoPlayer.EventType.STOPPED, onFinish, this);
            vp.node.on(VideoPlayer.EventType.ERROR, onError as any, this);

            // 起播失败早退
            setTimeout(() => {
                const t = Number((boundEl?.currentTime) ?? 0);
                const deltaOk = Math.max(0.02, this.videoMinProgressDelta * 0.5);
                if (!started && performance.now() - startAt > this.videoStartupTimeoutMs && t < deltaOk) {
                    safeResolve('startup-timeout');
                }
            }, this.videoStartupTimeoutMs + 50);

            // 兜底轮询
            const poll = setInterval(() => {
                try {
                    if (!vp?.node?.isValid || !vp.node.activeInHierarchy) { safeResolve('node-gone'); return; }
                    if (!boundEl) return;
                    const dur = Number(boundEl.duration || 0);
                    const t = Number(boundEl.currentTime || 0);
                    if (isFinite(dur) && dur > 0 && t >= dur - 0.2) safeResolve('poll-ended');
                } catch { }
            }, 400);

            cleanup = () => {
                clearTimeout(fallbackTimer);
                clearInterval(poll);
                vp.node.off(VideoPlayer.EventType.READY_TO_PLAY, onReady, this);
                vp.node.off(VideoPlayer.EventType.PLAYING, onPlaying, this);
                vp.node.off(VideoPlayer.EventType.COMPLETED, onFinish, this);
                vp.node.off(VideoPlayer.EventType.STOPPED, onFinish, this);
                vp.node.off(VideoPlayer.EventType.ERROR, onError as any, this);
                domUnbinders.forEach(fn => { try { fn(); } catch { } });
            };
        });
    }

    // 依据 videoWidth/Height 与 targetSize，锁定一次渲染矩形
    private _lockVideoSize(vp: VideoPlayer, el: HTMLVideoElement) {
        const srcW = Number(el.videoWidth || 0), srcH = Number(el.videoHeight || 0);
        const ui = vp.node.getComponent(UITransform)!;

        // 目标显示区域（你配置的像素盒）
        const boxW = this.targetSize.x, boxH = this.targetSize.y;

        // 没拿到尺寸就按目标盒先占位，避免 0×0
        if (!srcW || !srcH) {
            ui.setContentSize(boxW, boxH);
            (vp as any)?._forceUpdateRenderArea?.(true);
            return;
        }

        // 以 contain 计算一个等比缩放（VideoPlayer.keepAspectRatio=true 时也会 contain，这里手动锁住 UITransform）
        const scale = Math.min(boxW / srcW, boxH / srcH);
        const drawW = Math.max(1, Math.round(srcW * scale));
        const drawH = Math.max(1, Math.round(srcH * scale));

        ui.setContentSize(drawW, drawH);
        (vp as any)?._forceUpdateRenderArea?.(true);

        // 同步 DOM（避免内核再做一次布局导致跳）
        try {
            const impl = (vp as any)?._impl;
            const elDom: HTMLVideoElement | undefined = impl?._video || impl?._dom || impl?._element;
            if (elDom && (elDom as any).style) {
                (elDom as any).style.width = `${drawW}px`;
                (elDom as any).style.height = `${drawH}px`;
                (elDom as any).style.objectFit = 'contain';
                (elDom as any).style.background = 'transparent';
            }
        } catch { }
    }

    // 等到 videoWidth/Height 稳定（两次读取一致），再回调
    private _waitStableSize(vp: VideoPlayer, el: HTMLVideoElement, timeoutMs = 800): Promise<void> {
        return new Promise<void>((resolve) => {
            const start = performance.now();
            let lastW = 0, lastH = 0, stableCnt = 0;
            const tick = () => {
                const w = Number(el.videoWidth || 0);
                const h = Number(el.videoHeight || 0);
                if (w > 0 && h > 0) {
                    if (w === lastW && h === lastH) {
                        stableCnt++;
                    } else {
                        stableCnt = 0;
                        lastW = w; lastH = h;
                    }
                    // 连续两次一致认为稳定（也可设为3次更保守）
                    if (stableCnt >= 2) {
                        this._lockVideoSize(vp, el);
                        resolve();
                        return;
                    }
                    this._lockVideoSize(vp, el); // 未稳定也先锁一次，减少可见跳变
                }
                if (performance.now() - start > timeoutMs) {
                    // 超时也结束，避免卡死
                    this._lockVideoSize(vp, el);
                    resolve();
                    return;
                }
                requestAnimationFrame(tick);
            };
            // 先来一刀，马上锁一次（避免初次显示 300×150）
            this._lockVideoSize(vp, el);
            requestAnimationFrame(tick);
        });
    }

    // ── 工具 ──────────────────────────────────────────────
    private _loadVideoClip(path: string): Promise<VideoClip | null> {
        return new Promise((resolve) => {
            resources.load(path, VideoClip, (err, clip) => {
                if (err) { console.warn('[CinematicFX] load video failed:', path, err); resolve(null); }
                else resolve(clip);
            });
        });
    }

    private _tuneHtmlVideo(vp: VideoPlayer) {
        try {
            const impl = (vp as any)?._impl;
            const el = impl?._video || impl?._dom || impl?._element;
            if (el) {
                el.muted = true; el.autoplay = true; el.playsInline = true;
                el.setAttribute?.('playsinline', 'true');
                el.setAttribute?.('webkit-playsinline', 'true');
                el.controls = false; el.preload = el.preload || 'auto';
                el.style?.setProperty('background', 'transparent');
                if (!el.crossOrigin) { try { el.crossOrigin = 'anonymous'; } catch { } }
            }
        } catch { }
    }

    private _setVideoPointerEvents(vp: VideoPlayer, block: boolean) {
        try {
            const impl = (vp as any)?._impl;
            const el = impl?._video || impl?._dom || impl?._element;
            if (el && el.style) {
                el.style.pointerEvents = block ? 'auto' : 'none';
                el.style.background = 'transparent';
            }
        } catch { }
    }

    // ── 黑幕：创建/布局 + 引用计数 ─────────────────────────
    private _ensureAndLayoutSurroundDimmer(videoW: number, videoH: number): { group: Node, op: UIOpacity } {
        if (!this._dimGroup || !this._dimGroup.isValid) {
            const group = new Node('__CinematicDimmerSurround__');
            group.layer = this.node.layer;
            const op = group.addComponent(UIOpacity); op.opacity = 0;

            const solid = this._getSolidSpriteFrame();
            const mkBar = (n: string) => {
                const b = new Node(n); b.layer = this.node.layer;
                const ui = b.addComponent(UITransform);
                const sp = b.addComponent(Sprite);
                sp.spriteFrame = solid; sp.color = new Color(0, 0, 0, 255);
                sp.sizeMode = Sprite.SizeMode.CUSTOM;
                if (this.dimBlocksInput) b.addComponent(BlockInputEvents);
                group.addChild(b);
                return b;
            };
            mkBar('top'); mkBar('bottom'); mkBar('left'); mkBar('right');

            this.node.addChild(group);
            this._dimGroup = group;
            this._dimOp = op;
        }

        const group = this._dimGroup!;
        const canvasUI = director.getScene()?.getComponentInChildren(Canvas)?.getComponent(UITransform);
        const W = canvasUI?.width ?? 720, H = canvasUI?.height ?? 1280;
        const leftW = Math.max(0, (W - videoW) / 2);
        const topH = Math.max(0, (H - videoH) / 2);

        const top = group.getChildByName('top')!.getComponent(UITransform)!;
        const bottom = group.getChildByName('bottom')!.getComponent(UITransform)!;
        const left = group.getChildByName('left')!.getComponent(UITransform)!;
        const right = group.getChildByName('right')!.getComponent(UITransform)!;

        top.setContentSize(W, topH);
        bottom.setContentSize(W, topH);
        left.setContentSize(leftW, videoH);
        right.setContentSize(leftW, videoH);

        group.getChildByName('top')!.setPosition(0, (H - topH) / 2, 0);
        group.getChildByName('bottom')!.setPosition(0, -(H - topH) / 2, 0);
        group.getChildByName('left')!.setPosition(-(W - leftW) / 2, 0, 0);
        group.getChildByName('right')!.setPosition((W - leftW) / 2, 0, 0);

        group.setSiblingIndex(this.node.children.length - 1);
        return { group, op: this._dimOp! };
    }

    private _fade(op: UIOpacity, to: number, ms: number) {
        tween(op).stop();
        tween(op).to(ms / 1000, { opacity: to }).start();
    }

    private async _withDimmer<T>(enabled: boolean, fn: () => Promise<T> | T): Promise<T> {
        if (!enabled) return await fn();

        const { group, op } = this._ensureAndLayoutSurroundDimmer(this.targetSize.x, this.targetSize.y);
        const firstUser = (this._dimRef++ === 0);
        if (firstUser) this._fade(op, this.dimOpacity, this.dimFadeMs);
        else if (op.opacity < this.dimOpacity) this._fade(op, this.dimOpacity, 80);

        try {
            return await fn();
        } finally {
            this._dimRef = Math.max(0, this._dimRef - 1);
            if (this._dimRef === 0 && this._dimGroup?.isValid) {
                const g = this._dimGroup, o = this._dimOp!;
                tween(o).stop();
                tween(o).to(this.dimFadeMs / 1000, { opacity: 0 }).call(() => { try { g.destroy(); } catch { } }).start();
                this._dimGroup = null; this._dimOp = null;
            }
        }
    }

    private _getSolidSpriteFrame(): SpriteFrame {
        if (CinematicFX._solidSF) return CinematicFX._solidSF;
        // 用 1x1 canvas 生成一个纯白像素（Web）
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
        const img = new ImageAsset(canvas);
        const tex = new Texture2D(); tex.image = img;
        const sf = new SpriteFrame(); sf.texture = tex;
        CinematicFX._solidSF = sf; return sf;
    }

    // ── 看门狗 ────────────────────────────────────────────
    update() {
        if (!this._pumpRunning && this._videoQueue.length > 0) this._pumpVideoQueue();

        if (this._pumpRunning) {
            const now = performance.now();
            if (this._videoLastStartAt > 0 && (now - this._videoLastStartAt) > this.videoHealthTimeoutMs) {
                console.warn('[CinematicFX] video watchdog reset.');
                const players = this.node.getComponentsInChildren(VideoPlayer);
                for (const p of players) { try { p.node.destroy(); } catch { } }
                this._pumpRunning = false;
                this._pumpVideoQueue();
            }
        }
    }
}
