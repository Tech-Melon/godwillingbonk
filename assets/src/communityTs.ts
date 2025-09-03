import {
  _decorator, Component, instantiate, Node, Prefab, Vec3, UITransform,
  input, Input, EventTouch, PhysicsSystem2D, ERigidBody2DType, Vec2, RigidBody2D,
  Label, UIOpacity, tween, v3, Color
} from 'cc';

const { ccclass, property } = _decorator;
// 顶部 import 里增加：
import { JuiceFX } from './juice';               // 你的 JuiceFX 脚本（文件名大小写以你工程为准）
import { JuiceAssets } from './juiceAssets';     // 你刚做的资源管理器
import { communityMerge, IMergeGame } from './communityMerge';

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

    @property({ type: Node, tooltip: '果汁特效的父节点（一般挂在画布下的最上层）' })
    fxRoot: Node | null = null; // [NEW]

    @property(JuiceFX)
    juiceFX: JuiceFX | null = null;   // 在 Inspector 里把挂了 JuiceFX 的节点拖进来

    @property(Label)
    scoreLabel: Label = null; // 分数显示

    private score: number = 0; // 当前分数

    // private juiceFx: JuiceFX | null = null; // [NEW]

    private candleSelected: Node = null; // 当前选中的烛台
    // private cntTest = 0;               // [REMOVED] 不再按 0..4 轮询
    private currentNode: Node | null = null;
    private nextNode: Node | null = null;
    private dragging = false;

    // 放在 class communityTs 内其它 @property 之后
    @property({ tooltip: '单个物体的重力倍率（>1 掉得更快）' })
    fallGravityScale: number = 1;

    @property({ tooltip: '线性阻尼（空气阻力）；越小越快，0~0.05 较丝滑' })
    linearDamping: number = 0;

    @property({ tooltip: '角阻尼（转动阻尼）；越大越稳，减少旋转抖动' })
    angularDamping: number = 0;

    @property({ tooltip: '是否开启连续碰撞（避免高速穿透）' })
    useBulletCCD: boolean = false;

    @property({ tooltip: '是否固定旋转（掉落不乱转，更稳更丝滑）' })
    fixedRotation: boolean = false;

    @property({ tooltip: '初始下落速度' })
    initialFallSpeed: number = -60; // 初始下落速度

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
    // 每个元素表示一个等级的颜色方案
    private tierColors: { font: Color; outline: Color; shadow: Color }[] = [
        // tier 0
        { font: new Color(200, 200, 200), outline: new Color(80, 80, 80), shadow: new Color(0, 0, 0, 120) },
        // tier 1
        { font: new Color(100, 200, 255), outline: new Color(30, 100, 180), shadow: new Color(0, 0, 100, 120) },
        // tier 2
        { font: new Color(120, 255, 120), outline: new Color(20, 150, 20), shadow: new Color(0, 100, 0, 120) },
        // tier 3
        { font: new Color(255, 220, 120), outline: new Color(200, 150, 30), shadow: new Color(100, 80, 0, 120) },
        // tier 4
        { font: new Color(255, 150, 100), outline: new Color(180, 60, 30), shadow: new Color(100, 0, 0, 120) },
        // tier 5
        { font: new Color(255, 100, 200), outline: new Color(150, 30, 120), shadow: new Color(80, 0, 50, 120) },
        // tier 6
        { font: new Color(200, 150, 255), outline: new Color(100, 60, 200), shadow: new Color(50, 0, 100, 120) },
        // tier 7
        { font: new Color(255, 255, 150), outline: new Color(180, 180, 30), shadow: new Color(100, 100, 0, 120) },
        // tier 8
        { font: new Color(255, 180, 60), outline: new Color(200, 100, 20), shadow: new Color(120, 60, 0, 120) },
        // tier 9
        { font: new Color(255, 80, 80), outline: new Color(180, 20, 20), shadow: new Color(120, 0, 0, 120) },
        // tier 10
        { font: new Color(255, 240, 120), outline: new Color(220, 180, 40), shadow: new Color(150, 100, 0, 120) },
    ];

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
        // 预载三套系列，每套 10 张（根据你的数量改）
        JuiceAssets.I.preload({ juice_l: 10, juice_o: 10, juice_q: 10 })
        .then(() => {
            // 把场景里的 communityMerge 都接到本管理器 & 共享 JuiceFX
            this._wireMergeNodes();
            // 也可以给 JuiceFX 设一套默认皮肤（可选）
            return JuiceAssets.I.getSetByStyle('classic');
        })
        .then(set => {
            if (this.juiceFX && set) this.juiceFX.init(set);
        })
        .catch(err => {
            console.error('[communityTs] preload/wire failed:', err);
        });
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this.touchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input.off(Input.EventType.TOUCH_END, this.touchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.touchEnd, this);
    }

    touchStart(e: EventTouch): void {
        if (!this.currentNode) {
            this.promoteNextToCurrent(e);
            this.spawnNextCommunity(); // 补队列
        }
        this.dragging = true;
        this.syncCurrentXWithTouch(e);
    }

    touchMove(e: EventTouch): void {
        if (!this.dragging || !this.currentNode) return;
        this.syncCurrentXWithTouch(e);
    }

    touchEnd(e: EventTouch): void {
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

        // —— 关键调参 —— //
        rb.gravityScale = this.fallGravityScale;    // 让它“更快”下落（>1）
        rb.linearDamping = this.linearDamping;      // 小阻尼：速度更顺滑
        rb.angularDamping = this.angularDamping;    // 大一点：减少乱转的抖动
        rb.bullet = this.useBulletCCD;              // 开启 CCD 避免高速穿透
        rb.fixedRotation = this.fixedRotation;      // 不想旋转就勾上，更稳
        rb.enabledContactListener = true;           // 碰撞监听

        // 清速度，避免拖拽阶段的横向残留
        rb.linearVelocity = new Vec2(0, this.initialFallSpeed);
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
        // 🔑 获取 communityRoot 的 UITransform，算出允许的左右边界
        const rootUI = this.communityRoot.getComponent(UITransform)!;
        const halfW = rootUI.width / 2;
        // 当前节点自身宽度（避免模型一半超出去）
        const nodeUI = this.currentNode.getComponent(UITransform);
        const halfNodeW = nodeUI ? nodeUI.width / 2 : 0;

        const minX = -halfW + halfNodeW;
        const maxX = halfW - halfNodeW;
        // 限制 local.x 不越界
        const clampedX = Math.min(maxX, Math.max(minX, local.x));
        this.currentNode.setPosition(clampedX, this.dropLineY, 0);

        // 🔥 烛台跟随逻辑保持不变
        if (this.candleSelected) {
            const currentNodeWorld = this.currentNode.getWorldPosition();
            const h = nodeUI ? nodeUI.height : 0;
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
                // tier = Math.max(this.minTier, tier - 1);
                if (tier > this.minTier) tier = tier - 1;          // 优先往下
                else if (tier < allowedMax) tier = tier + 1;       // 在最小档就往上
                // 否则两边都没路：只能保留
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
        const tier = this.nextFruitTier();        // [NEW] 0~10
        const prefab = this.communityPrefabs[tier];
        if (!prefab) return;

        const n = instantiate(prefab);
        n.setParent(this.nextCommunityRoot);
        n.setPosition(this.nextSlotX, this.nextSlotY, 0);

        const rb = n.getComponent(RigidBody2D) || n.addComponent(RigidBody2D);  // ← 新增这一句的 add
        if (rb) rb.type = ERigidBody2DType.Kinematic; // 候场不下坠
        // === [NEW] 注入合成组件 ===
        let cm = n.getComponent(communityMerge);
        
        if (!cm) cm = n.addComponent(communityMerge);
        cm.tier = tier;
        cm.game = this;

        this.nextNode = n;

        // 更新状态（最高已生成等级、反连发记录） [NEW]
        this.highestTierSpawned = Math.max(this.highestTierSpawned, tier);
        this.lastTwo.push(tier);
        if (this.lastTwo.length > 2) this.lastTwo.shift();
    }

    public mergeSpawn(tier: number, worldPos: Vec3): void {
        const clamped = Math.min(
            tier,
            Math.min(this.hardCapTier, this.communityPrefabs.length - 1)
        );
        const prefab = this.communityPrefabs[clamped];
        if (!prefab) return;

        const n = instantiate(prefab);
        n.setParent(this.communityRoot);

        // 世界坐标 -> communityRoot 局部坐标
        const ui = this.communityRoot.getComponent(UITransform)!;
        const local = ui.convertToNodeSpaceAR(worldPos);
        n.setPosition(local);

        // 让新果落地并具备继续合成能力
        const rb = n.getComponent(RigidBody2D) || n.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Dynamic;
        rb.linearVelocity = new Vec2(0, 0); // 轻微向上弹感

        let cm = n.getComponent(communityMerge);
        if (!cm) cm = n.addComponent(communityMerge);
        cm.tier = clamped;
        cm.game = this;

        // 同步已生成的最高等级（用于解锁更高掉落）
        this.highestTierSpawned = Math.max(this.highestTierSpawned, clamped);

        // TODO: 在这里加分/特效/音效
    }
    // === 计分策略（可自定义）：基于“合成后的 tier” ===
    // private pointsForTier(tier: number): number {
    //     return Math.max(2, Math.pow(2, tier) * 2);
    // }
    private pointsForTier(tier: number): number {
        const table = [0, 5, 15, 30, 60, 120, 250, 500, 1000, 2000, 4000];
        return table[tier] ?? table[table.length - 1];
    }

    private updateScoreLabel() {
        if (this.scoreLabel) this.scoreLabel.string = `${this.score}`;
    }
    /** 合成完成后：由 communityMerge 调用 */
    public onMerged(tier: number, worldPos: Vec3): void {
        const pts = this.pointsForTier(tier);
        this.score += pts;
        this.updateScoreLabel();
        this.showFloatingScore(worldPos, pts, tier);
    }
     /** 在合成点附近显示 “+X” 并自动销毁 */
    private showFloatingScore(worldPos: Vec3, points: number, tier: number) {
        if (!this.fxRoot) return;
        const ui = this.fxRoot.getComponent(UITransform);
        if (!ui) return;

        const local = ui.convertToNodeSpaceAR(worldPos);
        const n = new Node('ScoreFloat');
        n.setParent(this.fxRoot);
        n.setPosition(local.x, local.y + 20, 0);

        const fontSizeTable = [24, 26, 28, 30, 32, 34, 36, 38, 42, 46, 52];
        const fontSize = fontSizeTable[Math.max(0, Math.min(tier, fontSizeTable.length - 1))];

        const lab = n.addComponent(Label);
        lab.string = `+${points}`;
        lab.fontSize = fontSize;
        lab.lineHeight = Math.round(fontSize * 1.05);
        lab.useSystemFont = true;
        lab.isBold = true;

        // 颜色映射
        const scheme = this.tierColors[Math.min(tier, this.tierColors.length - 1)];
        if (scheme) {
            lab.color = scheme.font;

            lab.enableOutline = true;
            lab.outlineWidth = Math.max(2, Math.min(6, Math.round(fontSize * 0.1)));
            lab.outlineColor = scheme.outline;

            lab.enableShadow = true;
            lab.shadowColor = scheme.shadow;
            lab.shadowOffset = new Vec2(0, -2);
        }

        const op = n.addComponent(UIOpacity);
        op.opacity = 255;

        // 动画
        tween(n)
        .by(0.30, { position: v3(0, 40, 0) }, { easing: 'quadOut' })
        .start();
        tween(n)
        .to(0.15, { scale: v3(1.2, 1.2, 1) }, { easing: 'quadOut' })
        .to(0.25, { scale: v3(0.9, 0.9, 1) }, { easing: 'quadIn' })
        .to(0.15, { scale: v3(1, 1, 1) })
        .start();
        tween(op)
        .delay(0.35)
        .to(0.25, { opacity: 0 })
        .call(() => { if (n.isValid) n.destroy(); })
        .start();
    }



    playJuiceAt(tier: number, worldPos: Vec3, width: number, style: 'classic'|'minimal'|'slashOnly'): void {
        if (!this.juiceFX) return;

        Promise.all([
        JuiceAssets.I.getByTier(tier, 'juice_l'),
        JuiceAssets.I.getByTier(tier, 'juice_o'),
        JuiceAssets.I.getByTier(tier, 'juice_q'),
        ])
        .then(([particle, circle, slash]) => {
        // 本次合成临时换皮（你也可以把这三张缓存起来复用）
        this.juiceFX!.init({ particle, circle, slash });

        // 世界坐标 → JuiceFX 节点的“局部坐标”（showJuice 需要本地坐标）
        const ui = this.juiceFX!.node.getComponent(UITransform);
        const local = ui ? ui.convertToNodeSpaceAR(worldPos) : worldPos.clone();

        this.juiceFX!.showJuice(local, width, { style, autoDestroy: true });
        })
        .catch(err => console.error('[communityTs] playJuiceAt error:', err));
    }
    private _wireMergeNodes() {
        const merges = this.node.getComponentsInChildren(communityMerge);
        for (let i = 0; i < merges.length; i++) {
            const m = merges[i];
            m.attachGame(this, this.juiceFX); // ✅ 通过方法绑定，类型安全
        }
    }
    protected start(): void {
        // 启动时先准备一个 next
        this.spawnNextCommunity();
        console.log('CommunityTs started');
    }
}
