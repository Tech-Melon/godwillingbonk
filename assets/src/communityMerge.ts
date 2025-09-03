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
    resources,
    SpriteFrame,
} from 'cc';
import { JuiceFX } from './juice'; // ← 确保与文件名大小写一致
const { ccclass, property } = _decorator;

export interface IMergeGame {
    mergeSpawn(tier: number, worldPos: Vec3): void;
    playJuiceAt(tier: number, worldPos: Vec3, width: number, style: 'classic' | 'minimal' | 'slashOnly'): void; // ← 加 tier
    onMerged(tier: number, worldPos: Vec3): void;   // [ADD] 通知游戏层：tier 合成成功
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

    onLoad() {
        // 兼容：碰撞体可能挂在子节点
        this.rb = this.getComponent(RigidBody2D) || this.getComponentInChildren(RigidBody2D);
        this.col = this.getComponent(Collider2D) || this.getComponentInChildren(Collider2D);
        this.maxMergeSpeed = 50;
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
        this.juiceFX = fx;
    }

    private onBeginContact(selfCol: Collider2D, otherCol: Collider2D, contact: IPhysics2DContact | null) {
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

        if (!other) return;                // 不是水果
        if (other.tier !== this.tier) return; // 等级不同不合
        if (this.merging || other.merging) return;

        // 用 uuid 决定唯一发起者，避免双方同时触发
        if (this.node.uuid > other.node.uuid) return;

        // 稍等一帧多（~60ms），等速度稳定再判定
        this.scheduleOnce(() => {
            if (!this.isValid || !other.isValid) return;

            const rbA = this.rb || this.getComponent(RigidBody2D);
            const rbB = other.rb || other.getComponent(RigidBody2D);
            if (!rbA || !rbB) return;
            if (rbA.type !== ERigidBody2DType.Dynamic || rbB.type !== ERigidBody2DType.Dynamic) return;

            // 速度可能有轻微抖动，这里用长度判断
            const vA = rbA.linearVelocity ? rbA.linearVelocity.length() : 0;
            const vB = rbB.linearVelocity ? rbB.linearVelocity.length() : 0;

            // console.log('communityMerge onBeginContact', this.node.name, other.node.name, vA, vB, this.maxMergeSpeed);
            if (vA <= this.maxMergeSpeed && vB <= this.maxMergeSpeed) {
                // console.log('into merge', this.maxMergeSpeed, vA, vB);
                this.doMergeWith(other);
            }
        }, 0.06);
    }

    private doMergeWith(other: communityMerge) {
        if (!this.game) return;

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
        // ✅ 把 tier 一起交给管理器（用当前等级或 nextTier 都可以，看你想用哪套皮）
        this.game.playJuiceAt(this.tier, pos, fxWidth, this.fxStyle as any);
        // 再生成更高一级
        this.game.mergeSpawn(nextTier, pos);
        // ✅ 通知游戏层计分 + 飘字动画  // [ADD]
        // this.game.onMerged(nextTier, pos);
        // ✅ 新增：通知游戏层计分 + 飘字
        this.game?.onMerged(nextTier, pos);

        // 轻微延迟销毁更安全（给合成特效时间、避免同帧销毁回调问题）
        this.scheduleOnce(() => {
            if (this.isValid) this.node.destroy();
            if (other.isValid) other.node.destroy();
        }, 0.01);
    }
}
