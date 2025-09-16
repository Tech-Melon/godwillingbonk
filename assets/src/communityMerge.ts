// communityMerge.ts
import {
    _decorator,
    Component,
    Node,
    RigidBody2D,
    Collider2D,
    Contact2DType,
    IPhysics2DContact,
    Vec3,
    ERigidBody2DType,
    UITransform,
    Vec2,
} from 'cc';
import { JuiceFX } from './juice'; // ← 确保与文件名大小写一致
import { AudioManager } from './audioManager';
import { CinematicFX } from './cinematicFX';
const { ccclass, property } = _decorator;

export interface IMergeGame {
    hardCapTier: number;               // ← 新增这一行
    mergeSpawn(tier: number, worldPos: Vec3): void;
    playJuiceAt(tier: number, worldPos: Vec3, width: number, style: 'classic' | 'minimal' | 'slashOnly'): void; // ← 加 tier
    onMerged(tier: number, worldPos: Vec3): void;   // [ADD] 通知游戏层：tier 合成成功
    // ← 新增：合帧去抖的检查请求
    requestCheckGameOver(): void;
}

@ccclass('communityMerge')
export class communityMerge extends Component {
    @property({ tooltip: '当前水果等级（0..10）' })
    tier: number = 0;

    @property({ tooltip: '允许合成的最大速度（建议 6~12 起步）' })
    maxMergeSpeed: number = 6; // ← 放宽

    @property({ tooltip: '合成时使用的果汁特效风格：classic / minimal / slashOnly' })
    fxStyle: string = 'classic';

    @property(JuiceFX)
    public juiceFX: JuiceFX | null = null;

    public game: IMergeGame | null = null;

    private merging = false;
    private rb: RigidBody2D | null = null;
    private col: Collider2D | null = null;
    // 在 class communityMerge 内新增字段：
    private frozen = false;
    // 只播一次的开关
    private _landSfxPlayed = false;

    onLoad() {
        // 兼容：碰撞体可能挂在子节点
        this.rb = this.getComponent(RigidBody2D) || this.getComponentInChildren(RigidBody2D);
        this.col = this.getComponent(Collider2D) || this.getComponentInChildren(Collider2D);
        // this.maxMergeSpeed = 50;
    }

    onEnable() {
        if (this.col) {
            this.col.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }
    }

    onDisable() {
        if (this.col) {
            this.col.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
        }
    }

    /** 供管理器调用：一次性把 game 与 juiceFX 接上 */
    public attachGame(game: IMergeGame, fx: JuiceFX | null) {
        this.game = game;
        // this.juiceFX = fx;
        if (!this.juiceFX && fx) this.juiceFX = fx;
    }

    private onBeginContact(selfCol: Collider2D, otherCol: Collider2D, contact: IPhysics2DContact | null) {
        // ✅ 游戏结束或自身已冻结：直接不处理
        if ((this.game as any)?.isGameOver) return;
        if (this.frozen) return;  // 若你已加了 freeze 机制
        // 对方可能是子节点上的碰撞体，向上找组件
        function getComponentInAncestors<T extends Component>(node: Node, type: new () => T): T | null {
            let current: Node | null = node.parent;
            while (current) {
                const comp = current.getComponent(type);
                if (comp) return comp;
                current = current.parent;
            }
            return null;
        }
        const other =
            otherCol.getComponent(communityMerge) ||
            otherCol.node.getComponent(communityMerge) ||
            otherCol.node.getComponentInChildren(communityMerge) ||
            getComponentInAncestors(otherCol.node, communityMerge);
        if (!other) {
            // console.log('contact: ', selfCol.node.name, otherCol.node.name);
            if (this._landSfxPlayed === false) {
                if (otherCol.node.name === 'bottom') {
                    const minImpactSpeed = 5;
                    const rbA = this.rb || this.getComponent(RigidBody2D);
                    const selfVy = rbA ? rbA.linearVelocity.y : 0;
                    const relVy = selfVy; // 自己相对对方
                    // console.log('impact speed', relVy);
                    if (relVy < -minImpactSpeed) {
                        this._landSfxPlayed = true;
                        AudioManager.I.playLand(1);
                    }
                }
            }
            return;                // 不是水果
        }
        // ✅ 对方已冻结或游戏结束，也不处理
        if (other.frozen || (other.game as any)?.gameOver === true) return;
        const rbA = this.rb || this.getComponent(RigidBody2D);
        const rbB = other.rb || other.getComponent(RigidBody2D);
        if (!rbA || !rbB) return;
        if (rbA.type !== ERigidBody2DType.Dynamic || rbB.type !== ERigidBody2DType.Dynamic) return;
        if (other.tier !== this.tier) return;
        if (this.merging || other.merging) return;
        // console.log('contact: ', selfCol.node.name, otherCol.node.name);
        // 用 uuid 决定唯一发起者，避免双方同时触发
        if (this.node.uuid > other.node.uuid) return;
        // ✅ 立即“预占”合并（上锁），防止同一节点同帧对多个对象发起多个合并
        this.merging = true;
        other.merging = true;

        // 可选：每次接触时请求一次“合帧”结束检查
        (this.game as any)?.requestCheckGameOver?.();
        // 稍等一帧多（~60ms），等速度稳定再判定
        this.scheduleOnce(() => {
            // ✅ 回调触发时再检查一次：游戏是否已结束 / 是否被冻结
            const isOver2 = (this.game as any)?.isGameOver;
            // if (!this.isValid || !other.isValid) return;
            if (!this.isValid || !other.isValid || this.frozen || other.frozen || isOver2) {
                if (this.isValid) this.merging = false;
                if (other.isValid) other.merging = false;
                return;
            }
            // const rbA = this.rb || this.getComponent(RigidBody2D);
            // const rbB = other.rb || other.getComponent(RigidBody2D);
            // if (!rbA || !rbB) return;
            // if (rbA.type !== ERigidBody2DType.Dynamic || rbB.type !== ERigidBody2DType.Dynamic) return;

            // 速度可能有轻微抖动，这里用长度判断
            const vA = rbA.linearVelocity ? rbA.linearVelocity.length() : 0;
            const vB = rbB.linearVelocity ? rbB.linearVelocity.length() : 0;
            // console.log('speed check', this.maxMergeSpeed, vA, vB);
            if (vA <= this.maxMergeSpeed && vB <= this.maxMergeSpeed) {
                // console.log('into merge', this.maxMergeSpeed, vA, vB);
                // ✅ 真正执行合成（doMergeWith 里仍会把双方 merging = true；这不冲突）
                this.doMergeWith(other);
            } else {
                // ✅ 不满足条件 → 回滚预占的锁
                if (this.isValid) this.merging = false;
                if (other.isValid) other.merging = false;
            }
        }, 0.06);
    }

    private doMergeWith(other: communityMerge) {
        if (!this.game) return;

        if (!this.isValid || !other.isValid) return;

        // ✅ 游戏结束/冻结早退：解锁并退出
        const isOver = (this.game as any)?.isGameOver;
        if (this.frozen || other.frozen || isOver) {
            this.merging = false;
            other.merging = false;
            return;
        }

        // ✅ 顶级兜底：两个都是上限，不合成（不销毁不生成）
        const cap = this.game?.hardCapTier ?? 10;
        if (this.tier >= cap && other.tier >= cap) {
            // 解锁，避免一直处于 merging 状态
            this.merging = false;
            other.merging = false;

            // 让它们稍微分开，避免连续帧再次进入接触回调
            const rbA = this.rb || this.getComponent(RigidBody2D);
            const rbB = other.rb || other.getComponent(RigidBody2D);
            if (rbA && rbB) {
                rbA.applyLinearImpulseToCenter(new Vec2(-10, 0), true);
                rbB.applyLinearImpulseToCenter(new Vec2(10, 0), true);
            }
            return;
        }

        this.merging = true;
        other.merging = true;

        const a = this.node.worldPosition;
        const b = other.node.worldPosition;
        const pos = new Vec3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, 0);

        // 取两者中较大的“可视宽度/直径”，用于特效规模
        const uiA = this.node.getComponent(UITransform);
        const uiB = other.node.getComponent(UITransform);
        const widthA = uiA ? uiA.width : 80;
        const widthB = uiB ? uiB.width : 80;
        const fxWidth = Math.max(widthA, widthB);

        const nextTier = this.tier + 1;
        if (CinematicFX.I?.hasVideoForTier(nextTier)) {
            CinematicFX.I.enqueueVideoForTier(nextTier);
        }

        // ✅ 把 tier 一起交给管理器（用当前等级或 nextTier 都可以，看你想用哪套皮）
        this.game.playJuiceAt(this.tier, pos, fxWidth, this.fxStyle as any);
        // 再生成更高一级
        this.game.mergeSpawn(nextTier, pos);
        // ✅ 通知游戏层计分 + 飘字动画  // [ADD]
        // this.game.onMerged(nextTier, pos);
        // ✅ 新增：通知游戏层计分 + 飘字
        this.game?.onMerged(nextTier, pos);
        // 播放合成音效
        if (!CinematicFX.I?.hasVideoForTier(nextTier)) {
            AudioManager.I.playMerge(nextTier, 1);
        }
        // 轻微延迟销毁更安全（给合成特效时间、避免同帧销毁回调问题）

        // 合成完成后也可以请求一次结束检查
        (this.game as any)?.requestCheckGameOver?.();
        this.scheduleOnce(() => {
            if (this.isValid) this.node.destroy();
            if (other.isValid) other.node.destroy();
        }, 0.01);
    }

    public async explodeWithJuice(
        juiceFX: JuiceFX,
        style: 'classic' | 'minimal' | 'slashOnly' = 'classic',
        duration = 0.6
    ): Promise<void> {
        try {
            if (juiceFX) {
                const wp = this.node.worldPosition.clone();
                await juiceFX.playBurstAt(wp, this.tier, style, duration);
            }
        } catch (e) {
            console.warn('[explodeWithJuice] fx error:', e);
        } finally {
            try { this.node.destroy(); } catch { }
        }
    }

    // 冻结：关掉碰撞、清理 pending 的 scheduleOnce、解除锁
    public freezeOnGameOver(): void {
        this.frozen = true;
        this.merging = false;
        this.unscheduleAllCallbacks();

        // 彻底不再接收碰撞
        // this.col = this.col || this.getComponent(Collider2D) || this.getComponentInChildren(Collider2D);
        // if (this.col) this.col.enabled = false;

        // 可选：让刚体静止
        const rb = this.rb || this.getComponent(RigidBody2D) || this.getComponentInChildren(RigidBody2D);
        if (rb) {
            // rb.linearVelocity = new Vec2(0, 0);
            // rb.angularVelocity = 0;
            rb.type = ERigidBody2DType.Static;
        }
    }

    // 解冻：恢复碰撞、重新调度 pending 的 scheduleOnce、解锁
    public unfreezeOnGameStart(): void {
        this.frozen = false;
        // this.scheduleAllCallbacks();
    }
}
