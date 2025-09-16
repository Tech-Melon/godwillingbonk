// BgmToggle.ts
import {
    _decorator, Component, Button, Sprite, SpriteFrame,
    input, Input, EventKeyboard, KeyCode
} from 'cc';
import { AudioManager } from './audioManager';

const { ccclass, property } = _decorator;

@ccclass('BgmToggle')
export class BgmToggle extends Component {
    @property(Sprite) icon: Sprite | null = null;
    @property({ type: SpriteFrame }) iconOn: SpriteFrame | null = null;
    @property({ type: SpriteFrame }) iconOff: SpriteFrame | null = null;

    onEnable() {
        this.refreshIcon();

        // 按钮点击
        const btn = this.getComponent(Button);
        if (btn) btn.node.on(Button.EventType.CLICK, this.onClick, this);

        // 可选：键盘 M 切换
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    onDisable() {
        const btn = this.getComponent(Button);
        if (btn) btn.node.off(Button.EventType.CLICK, this.onClick, this);
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
    }

    private onClick() {
        const on = AudioManager.I?.toggleBGM();
        this.refreshIcon(on);
        // 小动效（可选）
        //  this.node.scale = v3(0.95, 0.95, 1);
        //  tween(this.node).to(0.1, { scale: v3(1, 1, 1) }).start();
    }

    private onKey(e: EventKeyboard) {
        if (e.keyCode === KeyCode.KEY_M) {
            const on = AudioManager.I?.toggleBGM();
            this.refreshIcon(on);
        }
    }

    private refreshIcon(force?: boolean) {
        const isOn = typeof force === 'boolean' ? force : (AudioManager.I?.isBgmOn ?? true);
        if (this.icon) {
            this.icon.spriteFrame = isOn ? this.iconOn : this.iconOff;
        }
    }
}
