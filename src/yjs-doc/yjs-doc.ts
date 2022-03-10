import * as Y from 'yjs';
import { DocBlock, DocBlockText, NextEditorDoc, NextEditorDocCallbacks, assert, DocBlockTextActions, DocObject, DocBlockDelta } from '@nexteditorjs/nexteditor-core';

type MetaType = Y.Map<unknown>;
type BlockDataType = Y.Map<unknown>;
type BlocksType = Y.Array<BlockDataType>;
type AllBlocksType = Y.Map<BlocksType>;
type DocType = Y.Map<MetaType | AllBlocksType>;

export default class YjsDoc implements NextEditorDoc {
  doc: DocType;

  callbacks: NextEditorDocCallbacks | null = null;

  constructor(private yDoc: Y.Doc) {
    this.doc = this.yDoc.getMap('doc');
    this.doc.observeDeep(this.handleDocUpdated);
  }

  toJSON(): DocObject {
    const obj: {
      [index: string]: any;
    } = {};

    Array.from(this.doc.entries()).forEach(([key, value]) => {
      if (key === 'meta') {
        obj[key] = value.toJSON();
      } else if (key === 'blocks') {
        //
        obj.blocks = {};
        const allBlocks = value as AllBlocksType;
        Array.from(allBlocks.entries()).forEach(([containerId, containerBlocks]) => {
          const arr: DocBlock[] = [];
          assert(containerBlocks instanceof Y.Array);
          containerBlocks.forEach((v) => {
            arr.push(this.mapToBlockData(v));
          });
          //
          obj.blocks[containerId] = arr;
        });
      } else {
        assert(false, `unknown root object in doc: ${key}`);
      }
    });
    //
    return obj as DocObject;
  }

  registerCallbacks(callbacks: NextEditorDocCallbacks): void {
    this.callbacks = callbacks;
  }

  private handleDocUpdated = (events: Y.YEvent<Y.Array<unknown> | Y.Text>[], transaction: Y.Transaction) => {
    assert(this.callbacks, 'no callbacks registered');
    events.forEach((e) => {
      if (e instanceof Y.YTextEvent) {
        this.handleBlockTextChanged(e, transaction);
      } else if (e instanceof Y.YArrayEvent) {
        //
        this.handleContainerChanged(e, transaction);
        //
      }
    });
  };

  private handleBlockTextChanged = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    assert(this.callbacks, 'no callbacks registered');
    const path = event.path;
    assert(path.length === 4, 'invalid text event path');
    const [allBlocksKey, containerId, blockIndex, textKey] = path;
    assert(allBlocksKey === 'blocks', 'invalid block text change path');
    assert(typeof containerId === 'string', 'invalid text event container');
    assert(typeof blockIndex === 'number', 'invalid text event block index');
    assert(textKey === 'text', 'invalid text event target');
    const delta = event.delta;
    assert(delta, 'no delta of text event');
    this.callbacks.onUpdateBlockText(containerId, blockIndex, delta as DocBlockText, transaction.local);
  };

  private handleContainerChanged = (event: Y.YArrayEvent<Y.Map<unknown>>, transaction: Y.Transaction) => {
    //
    assert(this.callbacks, 'no callbacks registered');
    const path = event.path;
    assert(path.length === 2, 'invalid container event path');
    const [allBlocksKey, containerId] = path;
    assert(allBlocksKey === 'blocks', 'invalid block text change path');
    assert(typeof containerId === 'string', 'invalid text event container');
    const delta = event.delta;
    let blockIndex = 0;
    for (let i = 0; i < delta.length; i++) {
      const op = delta[i];
      if (op.retain) {
        blockIndex += op.retain;
      }
      if (op.insert) {
        const insertedBlocks = op.insert as Y.Array<Y.Map<unknown>>;
        // eslint-disable-next-line no-restricted-syntax
        for (const b of insertedBlocks) {
          this.callbacks.onInsertBlock(containerId, blockIndex, this.mapToBlockData(b), transaction.local);
        }
      }
      if (op.delete) {
        for (let deletedIndex = op.delete - 1; deletedIndex >= 0; deletedIndex--) {
          const deleteBlockIndex = blockIndex + deletedIndex;
          this.callbacks.onDeleteBlock(containerId, deleteBlockIndex, transaction.local);
        }
      }
    }
  };

  private mapToBlockData(map: BlockDataType): DocBlock {
    const json = map.toJSON();
    if (map.has('text')) {
      const blockText = map.get('text') as unknown as Y.Text;
      json.text = blockText.toDelta();
    }
    return json as DocBlock;
  }

  private blockDataToMap(data: DocBlock): BlockDataType {
    //
    const d = JSON.parse(JSON.stringify(data)) as DocBlock;
    const text = d.text;
    delete d.text;

    const map = new Y.Map<unknown>(Object.entries(d));
    //
    if (text) {
      const yText = new Y.Text();
      yText.applyDelta(text);
      map.set('text', yText);
    }
    return map;
  }

  private getAllBlocksMap(): AllBlocksType {
    const blocksMap = this.doc.get('blocks');
    assert(blocksMap, 'no blocks map');
    return blocksMap as AllBlocksType;
  }

  private getContainerBlocksMap(containerId: string): BlocksType {
    const blocks = this.getAllBlocksMap().get(containerId);
    assert(blocks, `no container: ${containerId}`);
    return blocks;
  }

  getContainerBlocks(containerId: string): DocBlock[] {
    const blocksData = this.getContainerBlocksMap(containerId);
    const blocks = blocksData.map((b) => this.mapToBlockData(b));
    return blocks;
  }

  getBlockData(containerId: string, blockIndex: number): DocBlock {
    const blocksData = this.getContainerBlocksMap(containerId);
    const blockData = blocksData.get(blockIndex);
    assert(blockData, `no block data: ${blockIndex}`);
    const json = blockData.toJSON();
    const blockText = blockData.get('text') as unknown as Y.Text;
    json.text = blockText.toDelta();
    return json as DocBlock;
  }

  localUpdateBlockText(containerId: string, blockIndex: number, deltaOps: DocBlockTextActions): DocBlockText {
    const blocksData = this.getContainerBlocksMap(containerId);
    const blockData = blocksData.get(blockIndex);
    assert(blockData, `no block data: ${blockIndex}`);
    const oldText = blockData.get('text') as unknown as Y.Text;
    oldText.applyDelta(deltaOps);
    return oldText.toDelta();
  }

  localInsertBlock(containerId: string, blockIndex: number, data: DocBlock): DocBlock {
    const blocksData = this.getContainerBlocksMap(containerId);
    const obj = this.blockDataToMap(data);
    blocksData.insert(blockIndex, [obj]);
    return data;
  }

  localDeleteBlock(containerId: string, blockIndex: number): DocBlock {
    const blocksData = this.getContainerBlocksMap(containerId);
    const data = blocksData.get(blockIndex);
    const obj = this.mapToBlockData(data);
    blocksData.delete(blockIndex);
    return obj;
  }

  localUpdateBlockData(containerId: string, blockIndex: number, delta: DocBlockDelta): DocBlock {
    const oldBlockData = this.getBlockData(containerId, blockIndex);
    return oldBlockData;
  }

  localInsertChildContainer(containerId: string, blocks: DocBlock[]): void {
  }

  localDeleteChildContainers(containerIds: string[]): void {

  }
}
