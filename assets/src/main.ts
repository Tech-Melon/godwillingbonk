import { _decorator, Component} from 'cc';
const { ccclass, property } = _decorator;

@ccclass('main')
export class main extends Component {

    start() {
        // console.log('main start');
    }

    onLoad() {
        // —— 发行常用初始化 —— //
        // 竖屏 + 等比缩放（留边）
        // try { view.setOrientation(macro.ORIENTATION_PORTRAIT); } catch {}
        // view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_HEIGHT);
        // view.resizeWithBrowserSize(true);

        // 可选：发行环境关闭调试可视化
        // try { profiler.hideStats(); } catch {}
        // try { PhysicsSystem2D.instance.debugDrawFlags = EPhysics2DDrawFlags.None; } catch {}

        // 如果只想初始化一次（多场景），解除注释：
        // director.addPersistRootNode(this.node);
    }
    update(deltaTime: number) {
        
    }
}


