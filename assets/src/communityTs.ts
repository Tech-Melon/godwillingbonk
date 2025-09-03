import { _decorator, Component, instantiate, Node, Prefab, Vec3, UITransform, input, Input, EventTouch, PhysicsSystem2D, ERigidBody2DType, Vec2, RigidBody2D } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('communityTs')
export class communityTs extends Component {
    @property(Node)
    communityRoot: Node = null;   // 当前正在操作的元素父节点

    @property(Node)
    nextCommunityRoot: Node = null;   // 下一个待操作的元素的父节点

    @property([Prefab])
    communityPrefabs: Prefab[] = [];   // 这里存放 11 个元素的预制体（下标 0..10 即等级 0..10）

    @property
    dropLineY: number = 0;   // 投放线

    @property({ tooltip: '候场位相对 nextCommunityRoot 的局部坐标' })
    nextSlotX: number = 0;

    @property({ tooltip: '候场位相对 nextCommunityRoot 的局部坐标' })
    nextSlotY: number = 0;

    @property(Node)
    candleL: Node = null;   // 这里存放 candleL 的节点

    @property(Node)
    candleR: Node = null;   // 这里存放 candleR 的节点

    private candleSelected: Node = null; // 当前选中的烛台
    // private cntTest = 0;               // [REMOVED] 不再按 0..4 轮询
    private currentNode: Node | null = null;
    private nextNode: Node | null = null;
    private dragging = false;

    // -------------------- 生成逻辑（0-based 等级）--------------------
    @property({ tooltip: '最小等级（与数组下标一致）' })
    minTier: number = 0;                 // [NEW] 0-based

    @property({ tooltip: '基础上限：起始只在 [minTier..baseMaxTier] 内抽取' })
    baseMaxTier: number = 4;             // [NEW] 例如只发 0..4

    @property({ tooltip: '绝对上限（不超过 prefab.length-1）' })
    hardCapTier: number = 10;            // [NEW] 最高 10（共 11 档）

    @property({ tooltip: '反连发：同级连续两次后第三次强制降一档' })
    antiStreak: boolean = true;          // [NEW]

    @property({ tooltip: '基础权重（对应 0..N 档）。例如 [40,30,15,10,5] 对应 0..4' })
    baseWeights: number[] = [40, 30, 15, 10, 5]; // [NEW]

    private highestTierSpawned: number = 0; // [NEW] 记录已“生成”过的最高等级（合成更高时可手动同步）
    private lastTwo: number[] = [];         // [NEW] 最近两次生成的 tier（0-based）

    protected onLoad(): void {
        if (this.communityRoot) {
            this.dropLineY = this.communityRoot.getWorldPosition().y;
            this.dropLineY = 0; // 临时用 0 代替，后续再调整
        }
        // 开启 2D 物理（若你已在项目设置里启用可忽略）
        if (!PhysicsSystem2D.instance.enable) {
            PhysicsSystem2D.instance.enable = true;
        }
        input.on(Input.EventType.TOUCH_START, this.touchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input.on(Input.EventType.TOUCH_END, this.touchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.touchEnd, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.touchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input.off(Input.EventType.TOUCH_END, this.touchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.touchEnd, this);
    }

    touchStart(e: EventTouch): void {
        console.log('touchStart: ', e);
        if (!this.currentNode) {
            this.promoteNextToCurrent(e);
            this.spawnNextCommunity(); // 补队列
        }
        this.dragging = true;
        this.syncCurrentXWithTouch(e);
    }

    touchMove(e: EventTouch): void {
        console.log('touchMove: ', e);
        if (!this.dragging || !this.currentNode) return;
        this.syncCurrentXWithTouch(e);
    }

    touchEnd(e: EventTouch): void {
        console.log('touchEnd: ', e);
        if (this.currentNode) {
            this.enableFall(this.currentNode); // 自由落体
            this.currentNode = null;
        }
        this.dragging = false;
        if (this.candleL) this.candleL.setPosition(-1000, this.candleL.position.y, 0); // [CHANGED] 判空
        if (this.candleR) this.candleR.setPosition(1000, this.candleR.position.y, 0);  // [CHANGED] 判空
    }

    /** 切换为动态刚体，让其自由落体 */
    private enableFall(node: Node): void {
        const rb = this.requireRigidBody2D(node);
        rb.type = ERigidBody2DType.Dynamic;
        rb.linearVelocity = new Vec2(0, 0); // 清速度，避免横向窜动
    }

    /** 确保节点有刚体 */
    private requireRigidBody2D(node: Node): RigidBody2D {
        let rb = node.getComponent(RigidBody2D);
        if (!rb) {
            rb = node.addComponent(RigidBody2D);
            rb.type = ERigidBody2DType.Dynamic;
        }
        return rb;
    }

    /** 把 next 提升为 current，放到投放线，X 取当前触点 */
    private promoteNextToCurrent(e: EventTouch): void {
        if (!this.nextNode) {
            // 如果还没 next，先补一个
            this.spawnNextCommunity();
            if (!this.nextNode) return;
        }

        const local = this.touchToLocalIn(this.communityRoot, e);

        this.nextNode.setParent(this.communityRoot);
        this.nextNode.setPosition(local.x, this.dropLineY, 0);

        if (local.x < 0) {
            this.candleSelected = this.candleL ?? null; // [CHANGED] 判空
        } else {
            this.candleSelected = this.candleR ?? null; // [CHANGED] 判空
        }

        const rb = this.requireRigidBody2D(this.nextNode);
        rb.type = ERigidBody2DType.Kinematic; // 跟手阶段使用 Kinematic

        this.currentNode = this.nextNode;
        this.nextNode = null;
    }

    /** 让 current 的 X 跟随触点，Y 固定在投放线 */
    private syncCurrentXWithTouch(e: EventTouch): void {
        if (!this.currentNode) return;
        const local = this.touchToLocalIn(this.communityRoot, e);
        this.currentNode.setPosition(local.x, this.dropLineY, 0);

        if (this.candleSelected) { // [CHANGED] 判空
            const currentNodeWorld = this.currentNode.getWorldPosition();
            const ui = this.currentNode.getComponent(UITransform);
            const h = ui ? ui.height : 0;
            this.candleSelected.setWorldPosition(
                currentNodeWorld.x,
                currentNodeWorld.y + h / 2 + 16,
                0
            );
        }
    }

    /** 将触摸点（屏幕坐标）转换为某个父节点下的局部坐标（AR） */
    private touchToLocalIn(parent: Node, e: EventTouch): Vec3 {
        const ui = parent.getComponent(UITransform)!;
        const p = e.getUILocation();
        return ui.convertToNodeSpaceAR(new Vec3(p.x, p.y, 0));
    }

    // -------------------- Spawn：新的候场元素（0-based 等级） --------------------
    /** 计算当前允许的最大等级（含边界，0-based） */
    private getAllowedMaxTier(): number { // [NEW]
        const hard = Math.min(this.hardCapTier, this.communityPrefabs.length - 1);
        // 已生成过更高等级则“解锁”到那一档；与基础上限取较大
        const byProgress = Math.max(this.baseMaxTier, this.highestTierSpawned);
        const cap = Math.min(byProgress, hard);
        return Math.max(this.minTier, cap);
    }

    /** 从 0..allowedMax 的权重中抽一个等级（0-based） */
    private nextFruitTier(): number { // [NEW]
        const allowedMax = this.getAllowedMaxTier(); // 例如 4
        if (allowedMax < this.minTier) return this.minTier;

        // baseWeights 只取 0..allowedMax 段
        const w = this.baseWeights.slice(this.minTier, allowedMax + 1);
        if (w.length === 0) return this.minTier;

        let tier = this.pickWeighted(w) + this.minTier; // 0-based

        // 反连发：同级已连续两次 -> 强制降一档（若可降）
        if (this.antiStreak && this.lastTwo.length >= 2) {
            const [a, b] = this.lastTwo.slice(-2);
            if (a === tier && b === tier) {
                tier = Math.max(this.minTier, tier - 1);
            }
        }
        return tier;
    }

    /** 按权重返回索引（从 0 到 weights.length-1） */
    private pickWeighted(weights: number[]): number { // [NEW]
        const sum = weights.reduce((s, v) => s + v, 0);
        let r = Math.random() * sum;
        for (let i = 0; i < weights.length; i++) {
            r -= weights[i];
            if (r < 0) return i;
        }
        return weights.length - 1;
    }

    // 生成下一个待操作元素（放到候场位）
    spawnNextCommunity(): void {
        // const index = this.cntTest % 5; // [REMOVED]
        // this.cntTest += 1;

        const tier = this.nextFruitTier();        // [NEW] 0~10
        const prefab = this.communityPrefabs[tier];
        if (!prefab) return;

        const n = instantiate(prefab);
        n.setParent(this.nextCommunityRoot);
        n.setPosition(this.nextSlotX, this.nextSlotY, 0);

        const rb = n.getComponent(RigidBody2D);
        if (rb) rb.type = ERigidBody2DType.Kinematic; // 候场不下坠

        this.nextNode = n;

        // 更新状态（最高已生成等级、反连发记录） [NEW]
        this.highestTierSpawned = Math.max(this.highestTierSpawned, tier);
        this.lastTwo.push(tier);
        if (this.lastTwo.length > 2) this.lastTwo.shift();
    }

    protected start(): void {
        // 启动时先准备一个 next
        this.spawnNextCommunity();
    }
}
