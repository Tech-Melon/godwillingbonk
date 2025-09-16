import { _decorator, Component, Label, Button, UIOpacity, tween, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GameOverDialog')
export class GameOverDialog extends Component {
    @property(Label) titleLabel: Label | null = null;
    @property(Label) scoreLabel: Label | null = null;
    @property(Button) retryButton: Button | null = null;

    private _onRetry: (() => void) | null = null;

    /** 初始化：设置分数与回调，并做淡入和面板缩放弹出 */
    public setup(score: number, onRetry: () => void) {
        this._onRetry = onRetry;
        if (this.scoreLabel) this.scoreLabel.string = `得分：${score}`;

        // 根节点淡入
        const op = this.getComponent(UIOpacity) || this.addComponent(UIOpacity);
        op.opacity = 0;
        tween(op).to(0.18, { opacity: 255 }).start();

        // 面板轻微缩放弹出
        const panel = this.node.getChildByName('Panel');
        if (panel) {
            panel.setScale(0.85, 0.85, 1);
            tween(panel).to(0.2, { scale: new Vec3(1, 1, 1)}, { easing: 'quadOut' }).start();
        }
    }

    /** 绑定到 Button 的 Click Events */
    public onRetryClick() {
        if (this._onRetry) this._onRetry();
        // 自己销毁
        this.node.destroy();
    }
}
