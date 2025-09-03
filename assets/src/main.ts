import { _decorator, Component, instantiate, Node, Prefab, resources, Sprite, SpriteFrame } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('main')
export class main extends Component {

    start() {
        console.log('main start');
    }

    update(deltaTime: number) {
        
    }
}


