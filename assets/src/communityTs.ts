import {
    _decorator, Component, instantiate, Node, Prefab, Vec3, UITransform,
    input, Input, EventTouch, PhysicsSystem2D, ERigidBody2DType, Vec2, RigidBody2D,
    Label, UIOpacity, tween, v3, Color,
    Graphics
} from 'cc';

const { ccclass, property } = _decorator;
// 顶部 import 里增加：
import { JuiceFX } from './juice';               // 你的 JuiceFX 脚本（文件名大小写以你工程为准）
import { JuiceAssets } from './juiceAssets';     // 你刚做的资源管理器
import { communityMerge, IMergeGame } from './communityMerge';
import { AudioManager } from './audioManager';

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

    // === 新增：结束线、状态、分数显示 ===
    @property({ tooltip: '越过该 Y 值则判定为游戏结束（communityRoot 局部坐标）' })
    gameOverLineY: number = 0; // 你根据实际场景高度调整

    private isGameOver = false;

    @property({ tooltip: '开发时显示越线虚线' })
    debugShowGameOverLine: boolean = true;
    @property({ tooltip: '虚线-单段长度（px）' })
    dashLen: number = 16;
    @property({ tooltip: '虚线-间隔长度（px）' })
    gapLen: number = 8;
    @property({ tooltip: '线宽（px）' })
    dangerLineWidth: number = 2;
    @property({ tooltip: '越线闪现时长（毫秒）' })
    dangerFlashMs: number = 500;

    // 可暴露到检查器
    @property({ tooltip: '每一波并行爆炸的数量' })
    explodeBatchSize: number = 8;

    @property({ tooltip: '两波之间的间隔(毫秒)' })
    explodeWaveGapMs: number = 40;

    @property({ tooltip: '快爆风格（minimal更快，slashOnly最快但比较单一）' })
    explodeFXStyle: string = 'minimal'; // 'classic' | 'minimal' | 'slashOnly'

    @property({ tooltip: '单个爆炸时长(秒)，结算时建议 0.45~0.6' })
    explodeFXDuration: number = 0.5;
    private dangerLineNode: Node | null = null;
    private _dangerBlinking = false;         // 正在闪现中避免重复触发
    // 带去抖的“越线检测”：连续 N 次发现越线才判结束，避免瞬时抖动
    private _overlineFrameCount = 0;         // 你已有的去抖计数（若没有，可以保留）
    private readonly _overlineRequired = 3;  // 连续 N 帧才真·结束
    // 爆炸间隔（毫秒），按需放到 @property 里也行
    private explodeStaggerMs: number = 80;
    // communityTs.ts 类里增加：
    private _checkQueued = false;

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
    private candleSelected: Node = null; // 当前选中的烛台
    private currentNode: Node | null = null;
    private nextNode: Node | null = null;
    private dragging = false;

    // 放在 class communityTs 内其它 @property 之后
    @property({ tooltip: '单个物体的重力倍率（>1 掉得更快）' })
    fallGravityScale: number = 3;

    @property({ tooltip: '线性阻尼（空气阻力）；越小越快，0~0.05 较丝滑' })
    linearDamping: number = 0;

    @property({ tooltip: '角阻尼（转动阻尼）；越大越稳，减少旋转抖动' })
    angularDamping: number = 0;

    @property({ tooltip: '是否开启连续碰撞（避免高速穿透）' })
    useBulletCCD: boolean = false;

    @property({ tooltip: '是否固定旋转（掉落不乱转，更稳更丝滑）' })
    fixedRotation: boolean = false;

    @property({ tooltip: '初始下落速度' })
    initialFallSpeed: number = 0; // 初始下落速度

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
    /** 预设的前几次生成顺序（tier 值数组），用完后走正常逻辑 */
    private presetTiers: number[] = [0, 0, 1, 2, 2, 3];
    private spawnCount: number = 0;

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

        if (this.debugShowGameOverLine) {
            // 等一帧，保证 UITransform 尺寸已就绪
            this.scheduleOnce(() => this.drawDangerLine(), 0);
        }
        this.refreshScoreUI();
    }

    /** 创建/重绘 红色虚线（位于 communityRoot 内，y=gameOverLineY） */
    public drawDangerLine() {
        if (!this.communityRoot) return;

        // 1) 若已存在，先销毁重画
        if (this.dangerLineNode && this.dangerLineNode.isValid) {
            this.dangerLineNode.destroy();
            this.dangerLineNode = null;
        }

        const lineNode = new Node('DangerLine');
        lineNode.setParent(this.communityRoot);
        lineNode.setPosition(0, this.gameOverLineY, 0);
        this.dangerLineNode = lineNode;

        const g = lineNode.addComponent(Graphics);
        g.lineWidth = this.dangerLineWidth;
        g.strokeColor = new Color(255, 0, 0, 255); // 红色

        // 2) 计算需要的横向宽度（以 communityRoot 的 UITransform 为准）
        const ui = this.communityRoot.getComponent(UITransform);
        const width = ui ? ui.width : 720; // 宽度兜底
        const half = width / 2;

        // 3) 画虚线：从 -half 到 +half，每段 dashLen，间隔 gapLen
        const dash = Math.max(2, this.dashLen);
        const gap = Math.max(1, this.gapLen);

        g.clear();
        for (let x = -half; x < half; x += (dash + gap)) {
            const x2 = Math.min(x + dash, half);
            g.moveTo(x, 0);
            g.lineTo(x2, 0);
        }
        g.stroke();

        // 放最上层（不被水果遮住）
        lineNode.setSiblingIndex(this.communityRoot.children.length - 1);

        // 根据开关隐藏/显示
        lineNode.active = this.debugShowGameOverLine;
    }

    /** 隐藏/显示虚线（不重画，仅切换可见性） */
    public setDangerLineVisible(show: boolean) {
        this.debugShowGameOverLine = show;
        if (this.dangerLineNode && this.dangerLineNode.isValid) {
            this.dangerLineNode.active = show;
        } else if (show) {
            this.drawDangerLine();
        }
    }

    public redrawDangerLine() {
        this.drawDangerLine();
    }
    /** 若不存在就画一条线；存在则仅更新位置 */
    private ensureDangerLine() {
        if (!this.dangerLineNode || !this.dangerLineNode.isValid) {
            if (this.drawDangerLine) {
                this.drawDangerLine();  // 你之前的画虚线方法
            } else {
                // 兜底：最简绘制（实线）；你已有 drawDangerLine 的话不会走到这
                const n = new Node('DangerLine');
                n.setParent(this.communityRoot);
                n.setPosition(0, this.gameOverLineY, 0);
                const g = n.addComponent(Graphics);
                g.lineWidth = 2;
                g.strokeColor = new Color(255, 0, 0, 255);
                const ui = this.communityRoot.getComponent(UITransform);
                const w = ui ? ui.width : 720;
                g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke();
                this.dangerLineNode = n;
            }
        } else {
            // 已存在时，仅同步 y 位置（防止你改了 gameOverLineY）
            this.dangerLineNode.setPosition(0, this.gameOverLineY, 0);
        }
    }
    /** 让越线线闪现 ms 毫秒；游戏未结束时才会自动隐藏 */
    private flashDangerLine(ms: number = this.dangerFlashMs) {
        if (this.isGameOver) {
            // 已经结束就常显，不做闪现
            this.ensureDangerLine();
            this.setDangerLineVisible?.(true); // 如果你实现了该函数
            if (this.dangerLineNode) this.dangerLineNode.active = true;
            return;
        }
        if (this._dangerBlinking) return; // 避免一帧多次触发

        this._dangerBlinking = true;
        this.ensureDangerLine();
        // 显示
        if (this.setDangerLineVisible) this.setDangerLineVisible(true);
        else if (this.dangerLineNode) this.dangerLineNode.active = true;

        // 500ms 后（或指定毫秒）隐藏（仅当未结束）
        const sec = Math.max(0.05, ms / 1000);
        this.scheduleOnce(() => {
            if (!this.isGameOver) {
                if (this.setDangerLineVisible) this.setDangerLineVisible(false);
                else if (this.dangerLineNode) this.dangerLineNode.active = false;
            }
            this._dangerBlinking = false;
        }, sec);
    }
    // === 对外：合成/得分时调用 ===
    public addScore(points: number) {
        this.score += points;
        this.refreshScoreUI();
    }

    private refreshScoreUI() {
        if (this.scoreLabel) {
            this.scoreLabel.string = `${this.score}`;
        }
    }
    // 取得水果“顶部”的局部 y（以 communityRoot 为基准）
    private _getFruitTopLocalY(n: Node): number {
        // n 是挂了 communityMerge 的水果节点，父级在 communityRoot 下
        // 如果你的预制不是 UI 节点，也没 UITransform，就用 0 高度兜底
        const ui = n.getComponent(UITransform);
        const halfH = ui ? ui.height * 0.5 : 0;
        return n.position.y + halfH;
    }
    // 过滤“候场/未落地”的对象：
    // 你若在 communityMerge 里有 hasLanded / isDropping 之类的标记，优先用标记；
    // 如果没有，就用刚体速度做个兜底（速度很小才当作“已落地”）
    private _isEligibleForGameOver(m: communityMerge): boolean {
        // 1) 排除不在层级里的
        if (!m.node.activeInHierarchy) return false;

        // 2) 排除候场/预览：若你的候场在 nextCommunityRoot 下，这里自然不会被 getComponentsInChildren(communityRoot) 找到；
        //    但如果你的候场也被挂在 communityRoot 下，建议在 communityMerge 里加一个 isPreview 标记；
        if ((m as any).isPreview) return false;

        // 3) 落地判断（推荐在 communityMerge 落地回调里置 hasLanded=true）
        if ((m as any).hasLanded === true) return true;

        // 4) 没有标记就用刚体速度兜底（需要你水果上有 RigidBody2D）
        const rb = m.getComponent(RigidBody2D);
        if (rb) {
            const v = rb.linearVelocity;
            // 速度很小，认为已经“安定”
            if (Math.abs(v.x) < 5 && Math.abs(v.y) < 5) return true;
        }
        return false;
    }


    // === 判定是否游戏结束（每次生成/落地/合成后都可调用）===
    private checkGameOver() {
        if (this.isGameOver) return;
        const dangerY = this.gameOverLineY; // 都用 communityRoot 局部
        const merges = this.communityRoot.getComponentsInChildren(communityMerge);

        let anyOver = false;
        for (let i = 0; i < merges.length; i++) {
            const m = merges[i];
            if (!this._isEligibleForGameOver(m)) continue;


            const topY = this._getFruitTopLocalY(m.node);
            // 调试日志（可临时打开）
            // console.log(`[DBG] fruit topY=${topY.toFixed(1)} vs dangerY=${dangerY}`);

            if (topY >= dangerY) {
                anyOver = true;
                break;
            }
        }

        if (anyOver) {
            // ✨ 第一次进入“越线态”的那一帧触发闪现
            if (this._overlineFrameCount === 0) {
                this.flashDangerLine(this.dangerFlashMs);
            }
            this._overlineFrameCount++;
            // if (this._overlineFrameCount >= this._overlineRequired) {
            //     // 真正结束前再打一次汇总日志，方便定位
            //     // console.warn(`[GAMEOVER] lineY=${dangerY}, reason=fruitTop>=line, frames=${this._overlineFrameCount}`);
            //     this.handleGameOver();
            // }
            if (this._overlineFrameCount >= this._overlineRequired) {
                this.onGameOverTriggered();  // ← 统一走这里
            }
        } else {
            this._overlineFrameCount = 0;
        }
    }

    public requestCheckGameOver(): void {
        if (this._checkQueued || this.isGameOver) return;
        this._checkQueued = true;
        this.scheduleOnce(() => {
            this._checkQueued = false;
            this.checkGameOver();  // 你已有的越界判定
        }, 0);
    }
    private onGameOverTriggered(): void {
        if (this.isGameOver) return;
        this.isGameOver = true;

        // 停止继续生成（如果你有投放/计时等）
        this.unscheduleAllCallbacks?.();

        // 冻结所有 community：关闭碰撞监听、取消排队的合成定时器
        const merges = this.communityRoot.getComponentsInChildren(communityMerge);
        for (const m of merges) {
            m.freezeOnGameOver();
        }

        // TODO: 这里可以弹出 GameOver UI、保存分数等
        // 让危险线常显
        this.ensureDangerLine();
        this.setDangerLineVisible?.(true);
        // 进入统一结算流程（异步，无需 await）
        this.handleGameOver();
    }
    // === 处理游戏结束：统一爆炸 + 禁用交互 + 声音 ===
    private async handleGameOver() {
        // if (this.isGameOver) return;
        // this.isGameOver = true;

        // 可选：播放一个结束 SFX / 停 BGM
        try {
            // AudioManager.I?.playSfx('land'); // 你可以换成更合适的音效键
            // AudioManager.I?.fadeOutBgm(0.8); // 若你有淡出 BGM 的方法
        } catch { }

        // 禁用投放 / 触控
        input.off(Input.EventType.TOUCH_START);
        input.off(Input.EventType.TOUCH_MOVE);
        input.off(Input.EventType.TOUCH_END);
        input.off(Input.EventType.TOUCH_CANCEL);
        this.ensureDangerLine();
        if (this.setDangerLineVisible) this.setDangerLineVisible(true);
        else if (this.dangerLineNode) this.dangerLineNode.active = true;
        // 让所有水果爆炸（使用现在的合成特效）
        await this.explodeAllCommunities();

        // 最终刷新分数到左上角（如果你有“结算面板”，也可在这里弹出）
        this.refreshScoreUI();
    }
    // 取得水果“顶部”的局部 y（以 communityRoot 为基准）
    // private _getFruitTopLocalY(n: Node): number {
    //     const ui = n.getComponent(UITransform);
    //     const halfH = ui ? ui.height * 0.5 : 0;
    //     return n.position.y + halfH;
    // }

    // 简易延时（秒）
    // —— 工具：延时（秒）
    private _wait(sec: number): Promise<void> {
        return new Promise<void>((resolve) => this.scheduleOnce(resolve, sec));
    }
    // private async explodeAllCommunities() {
    //     const merges = this.communityRoot.getComponentsInChildren(communityMerge);
    //     const tasks: Promise<void>[] = [];
    //     for (let i = 0; i < merges.length; i++) {
    //         tasks.push(merges[i].explodeWithJuice(this.juiceFX));
    //     }
    //     await Promise.allSettled(tasks);
    // }
    // —— 工具：包含 inactive 的收集（手写 DFS，别依赖 includeInactive）
    private _collectAllMerges(roots: Node[]): communityMerge[] {
        const out: communityMerge[] = [];
        const stack: Node[] = [];
        for (const r of roots) if (r) stack.push(r);

        while (stack.length) {
            const n = stack.pop()!;
            const cm = n.getComponent(communityMerge);
            if (cm) out.push(cm);
            // 注意：children 包含 inactive
            for (const c of n.children) stack.push(c);
        }
        return out;
    }
    // —— 从上到下严格逐个爆炸（不漏炸）
    // —— 分批并行从上到下引爆（快）
    private async explodeAllCommunities() {
        // 1) 收集（包含棋盘与候场）
        const roots: Node[] = [this.communityRoot, this.nextCommunityRoot].filter(Boolean) as Node[];
        const merges: communityMerge[] = [];
        const stack: Node[] = [...roots];

        while (stack.length) {
            const n = stack.pop()!;
            const cm = n.getComponent(communityMerge);
            if (cm) merges.push(cm);
            for (const c of n.children) stack.push(c); // 包含 inactive
        }

        if (merges.length === 0) return;

        // 2) 按顶部Y从高到低
        merges.sort((a, b) => this._getFruitTopLocalY(b.node) - this._getFruitTopLocalY(a.node));

        const batchSize = Math.max(1, this.explodeBatchSize);
        const gapSec = Math.max(0, this.explodeWaveGapMs) / 1000;
        const style = (this.explodeFXStyle as any) || 'minimal';
        const fxDur = Math.max(0.3, this.explodeFXDuration); // 安全下限

        // 3) 分批并行
        for (let i = 0; i < merges.length; i += batchSize) {
            const slice = merges.slice(i, i + batchSize);
            const tasks = slice.map(m => {
                if (!m || !m.node || !m.node.isValid) return Promise.resolve();
                // 提速关键：用“minimal/ slashOnly + 短 duration”
                return m.explodeWithJuice(this.juiceFX, style, fxDur)
                    .catch(() => { }); // 忽略单个异常
            });
            await Promise.all(tasks); // 等这一波都“启动并播完”
            if (i + batchSize < merges.length && gapSec > 0) {
                await this._wait(gapSec); // 小间隔营造瀑布感
            }
        }

        // 4) 兜底：再扫一遍，强制清掉任何残留
        const leftovers: communityMerge[] = [];
        const stack2: Node[] = [...roots];
        while (stack2.length) {
            const n = stack2.pop()!;
            const cm = n.getComponent(communityMerge);
            if (cm) leftovers.push(cm);
            for (const c of n.children) stack2.push(c);
        }
        for (const m of leftovers) {
            try { m.node.destroy(); } catch { }
        }
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
        if (this.isGameOver) return;
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
        if (this.isGameOver) return;
        let tier: number;
        if (this.spawnCount < this.presetTiers.length) {
            // 前 6 次走预设
            tier = this.presetTiers[this.spawnCount];
        } else {
            // 之后走原本逻辑
            tier = this.nextFruitTier();   // 0~10
        }
        this.spawnCount++;
        // const tier = this.nextFruitTier();        // [NEW] 0~10
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
        // cm.game = this;
        cm.attachGame(this, this.juiceFX);  // ← 必须接

        this.nextNode = n;

        // 更新状态（最高已生成等级、反连发记录） [NEW]
        this.highestTierSpawned = Math.max(this.highestTierSpawned, tier);
        this.lastTwo.push(tier);
        if (this.lastTwo.length > 2) this.lastTwo.shift();
        this.checkGameOver();
    }

    public mergeSpawn(tier: number, worldPos: Vec3): void {
        // ✅ 关键：仅当超过上限（例如 tier=11）才直接返回
        // 这不会影响 C9→C10；但会阻止 C10→C11 的生成，从源头避免“夹回 C10”的复制膨胀
        if (tier > this.hardCapTier) {
            // 这里什么都不做；得分/飘字等已由 onMerged 调用链处理（如果你在 doMergeWith 里触发）
            return;
        }

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

        // 正确接线：新生节点要接上 game / fx
        let cm = n.getComponent(communityMerge);
        if (!cm) cm = n.addComponent(communityMerge);
        cm.tier = clamped;
        // cm.game = this;
        cm.attachGame(this, this.juiceFX);   // ← 统一入口，别只赋 game

        // 同步已生成的最高等级（用于解锁更高掉落）
        this.highestTierSpawned = Math.max(this.highestTierSpawned, clamped);

        // TODO: 在这里加分/特效/音效
    }

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



    playJuiceAt(tier: number, worldPos: Vec3, width: number, style: 'classic' | 'minimal' | 'slashOnly'): void {
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
