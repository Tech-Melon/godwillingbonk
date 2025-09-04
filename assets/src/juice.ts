// JuiceFX.ts
import {
    _decorator,
    Component,
    Node,
    Sprite,
    SpriteFrame,
    Vec3,
    tween,
    UIOpacity,
    UITransform,
    math,
    sp,
} from 'cc';

const { ccclass, property } = _decorator;
import { JuiceAssets } from './juiceAssets';

type JuiceStyle = 'classic' | 'minimal' | 'slashOnly';
type JuiceOptions = {
    style?: JuiceStyle;     // 经典/极简/仅斩击
    duration?: number;      // 本次动效统一寿命（秒）
    autoDestroy?: boolean;  // 是否在寿命结束时销毁分组节点
    countScale?: number;      // 新增：数量缩放，1=原始，0.5=减半
};

@ccclass('JuiceFX')
export class JuiceFX extends Component {
    @property({ type: SpriteFrame, tooltip: '果粒贴图' })
    particle: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '水珠贴图' })
    circle: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '斩击贴图' })
    slash: SpriteFrame | null = null;

    /** 初始化贴图资源 */
    public init(data: { particle?: SpriteFrame; circle?: SpriteFrame; slash?: SpriteFrame }) {
        if (data.particle) this.particle = data.particle;
        if (data.circle) this.circle = data.circle;
        if (data.slash) this.slash = data.slash;

        // console.log('[JuiceFX:init]', {
        //     particle: !!this.particle,
        //     circle: !!this.circle,
        //     slash: !!this.slash,
        // });
    }

    protected start(): void {
        console.log('[JuiceFX] ready' );
    }
    /**
     * 在当前节点的局部坐标 pos 处播放果汁动效
     * @param pos  本节点局部坐标
     * @param width 尺度参考（建议传两球中更大的直径，用于粒子速度/位移估算）
     * @param options 风格/寿命/是否销毁
     */
    public showJuice(pos: Vec3, width: number, options: JuiceOptions = {}) {
        const style: JuiceStyle = options.style ?? 'classic';
        const life = Math.max(0.6, options.duration ?? 1.2);
        const autoDestroy = options.autoDestroy ?? true;

        // 1) 本次动效的临时分组容器
        const group = new Node('JuiceBurst');
        group.setPosition(pos);
        group.parent = this.node;

        // 2) 根据风格决定元素与数量
        const useParticle = style === 'classic' || style === 'minimal';
        const useCircle = style === 'classic' || style === 'minimal';
        const useSlash = style === 'classic' || style === 'slashOnly';

        const countScale = Math.max(0.2, options.countScale ?? 1);
        const particleCount = useParticle ? Math.round((style === 'minimal' ? 10 : 14) * countScale) : 0;
        const circleCount   = useCircle   ? Math.round((style === 'minimal' ? 10 : 20) * countScale) : 0;
        // const particleCount = useParticle ? (style === 'minimal' ? 10 : 14) : 0;
        // const circleCount = useCircle ? (style === 'minimal' ? 10 : 20) : 0;
        // 3) 生成并播放
        if (useParticle && this.particle) {
            for (let i = 0; i < particleCount; i++) {
                const n = this._spawnSprite(this.particle, group);
                this._playParticleTween(n, width, life, 0.85); // 粒子偏快
            }
        }

        if (useCircle && this.circle) {
            for (let i = 0; i < circleCount; i++) {
                const n = this._spawnSprite(this.circle, group);
                this._playCircleTween(n, width, life, 0.65); // 水珠偏慢
            }
        }

        if (useSlash && this.slash) {
            const n = this._spawnSprite(this.slash, group);
            this._playSlashTween(n, width, Math.min(life, 0.5)); // 斩击更短
        }

        // 4) 到寿命统一清理
        if (autoDestroy) {
            this.scheduleOnce(() => {
                if (group && group.isValid) group.destroy();
            }, life);
        }
    }

    private _spawnSprite(sf: SpriteFrame, parent: Node): Node {
        const n = new Node('fx');

        // 组件
        const sp = n.addComponent(Sprite);
        sp.spriteFrame = sf;

        // ✅ 关键：避免 0×0（两种任选其一）
        // 方案 A：用 TRIMMED（最省心）
        sp.sizeMode = Sprite.SizeMode.TRIMMED;

        // 方案 B：如果你项目要求 CUSTOM，就解开下面三行，并把上面的 TRIMMED 注释掉
        // sp.sizeMode = Sprite.SizeMode.CUSTOM;
        const tf = n.getComponent(UITransform) ?? n.addComponent(UITransform);
        const os = sf.originalSize ?? { width: 32, height: 32 };
        tf.setContentSize(os.width, os.height);   // ✅ CUSTOM 时必须设尺寸

        // 透明度
        const op = n.addComponent(UIOpacity);
        op.opacity = 255;

        // 初始姿态
        n.setScale(1, 1, 1);
        n.setRotationFromEuler(0, 0, 0);

        // 层级：让后添加的更靠上，避免被粒子盖住
        parent.addChild(n);
        n.setSiblingIndex(parent.children.length - 1);

        return n;
    }
    /** —— 粒子运动：快速飞散+缩小+淡出 —— */
    private _playParticleTween(n: Node, width: number, life: number, speedFactor: number) {
        const dir = this._randomDir();                  // 单位方向
        const dist = width * (0.55 + Math.random() * 0.9); // 飞散距离
        const moveTime = life * speedFactor;            // 主要运动时间
        const fadeTime = Math.max(0.08, life - moveTime);

        const target = new Vec3(dir.x * dist, dir.y * dist, 0);
        const startScale = 0.85 + Math.random() * 0.5;
        const endScale = 0.35 + Math.random() * 0.2;

        // 轻微随机旋转
        const rot = (Math.random() * 360) - 180;

        n.setScale(startScale, startScale, 1);
        n.setRotationFromEuler(0, 0, rot);

        const uiop = n.getComponent(UIOpacity)!;

        tween(n)
            .by(moveTime, { position: target }, { easing: 'cubicOut' })
            .parallel(
                tween(n).to(moveTime, { scale: new Vec3(endScale, endScale, 1) }, { easing: 'quartOut' }),
                tween(uiop).delay(moveTime * 0.7).to(fadeTime, { opacity: 0 })
            )
            .start();
    }

    /** —— 水珠：上抛/落下 + 轻微缩放 + 淡出 —— */
    private _playCircleTween(n: Node, width: number, life: number, speedFactor: number) {
        const dir = this._randomDir();
        // Y 方向略偏上，形成“溅起”感觉
        const biasY = 0.3 + Math.random() * 0.4;
        const dist = width * (0.45 + Math.random() * 0.6);

        const peak = new Vec3(dir.x * dist * 0.55, Math.abs(dir.y) * dist * biasY, 0);
        const end = new Vec3(dir.x * dist, 0, 0);

        const tUp = life * speedFactor * 0.45;
        const tDown = life * speedFactor * 0.45;
        const fadeTime = Math.max(0.06, life - (tUp + tDown));

        const startScale = 0.7 + Math.random() * 0.4;
        const midScale = startScale * (1.05 + Math.random() * 0.15);
        const endScale = startScale * 0.6;

        const uiop = n.getComponent(UIOpacity)!;
        n.setScale(startScale, startScale, 1);

        tween(n)
            .to(tUp, { position: peak }, { easing: 'sineOut' })
            .to(tDown, { position: end }, { easing: 'sineIn' })
            .start();

        tween(n)
            .to(tUp, { scale: new Vec3(midScale, midScale, 1) }, { easing: 'quartOut' })
            .to(tDown, { scale: new Vec3(endScale, endScale, 1) }, { easing: 'quartIn' })
            .start();

        tween(uiop)
            .delay(tUp + tDown * 0.6)
            .to(fadeTime, { opacity: 0 })
            .start();
    }

    /** —— 斩击：快速拉伸 + 旋转 + 淡出 —— */
    private _playSlashTween(n: Node, width: number, life: number) {
        const angle = (Math.random() * 60 - 30) + (Math.random() < 0.5 ? 90 : 0); // 随机两象限
        n.setRotationFromEuler(0, 0, angle);
        const uiop = n.getComponent(UIOpacity)!;

        const startScaleX = 0.2;
        const endScaleX = 1.5 + Math.random() * 0.6;
        const scaleY = 0.35 + Math.random() * 0.25;

        n.setScale(startScaleX, scaleY, 1);

        const stretch = Math.min(0.22, life * 0.45);
        const hold = Math.min(0.08, life * 0.15);
        const fade = Math.max(0.06, life - (stretch + hold));

        tween(n)
            .to(stretch, { scale: new Vec3(endScaleX, scaleY, 1) }, { easing: 'quadOut' })
            .delay(hold)
            .start();

        tween(uiop)
            .delay(stretch * 0.6)
            .to(fade, { opacity: 0 })
            .start();
    }

    /** —— 辅助：单位随机方向 —— */
    private _randomDir(): { x: number; y: number } {
        const a = Math.random() * Math.PI * 2;
        return { x: Math.cos(a), y: Math.sin(a) };
    }

    public async playBurstAt(
        worldPos: Vec3,
        tier: number,
        style: JuiceStyle = 'classic',
        duration = 1.0
    ): Promise<void> {
        // 1) 取资源（按 tier）并注入到本组件
        try {
            const particle = await JuiceAssets.I.getByTier(tier, 'juice_l');
            const circle   = await JuiceAssets.I.getByTier(tier, 'juice_o');
            const slash    = await JuiceAssets.I.getByTier(tier, 'juice_q');
            this.init({ particle, circle, slash });
        } catch (e) {
            console.warn('[JuiceFX.playBurstAt] load assets failed:', e);
            // 没资源也继续（showJuice 会根据是否有 sf 决定是否生成对应元素）
        }

        // 2) 世界坐标 → 本节点的局部坐标
        const localPos = this._toLocalPos(worldPos);

        // 3) 估一个“宽度”做为强度/位移参考（也可换成你自己的规则或传参）
        const width = this._estimateWidthByTier(tier);

        // 4) 复用现成的 showJuice（内部会自动销毁生成的分组）
        const life = Math.max(0.6, duration);
        this.showJuice(localPos, width, { style, duration: life, autoDestroy: true });

        // 5) 返回一个会在动效结束后 resolve 的 Promise（便于上层 await）
        return new Promise<void>((resolve) => {
            this.scheduleOnce(() => resolve(), life);
        });
    }

    /** 世界坐标 → 本节点局部坐标（UI/非 UI 都能用的安全写法） */
    private _toLocalPos(worldPos: Vec3): Vec3 {
        // 如果是 UI 节点，优先用 UITransform 的 AR 转换
        const ui = this.getComponent(UITransform);
        if (ui) {
            return ui.convertToNodeSpaceAR(worldPos);
        }
        // 通用兜底：建个临时子节点设世界坐标，读取其局部坐标后销毁
        const probe = new Node('__probe__');
        this.node.addChild(probe);
        probe.setWorldPosition(worldPos);
        const local = probe.position.clone();
        probe.removeFromParent();
        probe.destroy();
        return local;
    }

    /** 根据 tier 粗略估一个宽度（可按你实际水果直径/贴图尺寸改） */
    private _estimateWidthByTier(tier: number): number {
        // 方案 A：线性估计
        // return 40 + (tier - 1) * 8;

        // 方案 B：按贴图原尺寸估（若 particle 已就绪）
        if (this.particle) {
            const os = this.particle.originalSize;
            if (os?.width) return Math.max(32, os.width);
        }
        // 兜底
        return 64;
    }
}
