import * as Y from 'yjs';
import {
  DocBlock, DocBlockText, NextEditorDoc, NextEditorDocCallbacks,
  assert, DocBlockTextActions, DocObject, DocBlockDelta,
} from '@nexteditorjs/nexteditor-core';

type MetaType = Y.Map<unknown>;
type BlockDataType = Y.Map<unknown>;
type BlocksType = Y.Array<BlockDataType>;
type AllBlocksType = Y.Map<BlocksType>;
type DocType = Y.Map<MetaType | AllBlocksType>; // DocObject

export default class YjsDoc implements NextEditorDoc {
  doc: DocType;

  callbacks: NextEditorDocCallbacks | null = null;

  constructor(private yDoc: Y.Doc) {
    this.doc = this.yDoc.getMap('doc');
    this.doc.observeDeep(this.handleDocUpdated);
  }

  toJSON(): DocObject {
    const obj: DocObject = {
      blocks: {
        root: [],
      },
      meta: {},
    };

    Array.from(this.doc.entries()).forEach(([key, value]) => {
      if (key === 'meta') {
        obj.meta = value.toJSON();
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
        this.handleBlocksChanged(e, transaction);
      } else if (e instanceof Y.YMapEvent) {
        if (e.path.length === 1 && e.path[0] === 'blocks') {
          this.handleChildContainerChanged(e, transaction);
        } else if (e.path.length === 3) {
          this.handleBlockDataChanged(e, transaction);
        } else {
          assert(false, `unknown event ${e.path}`);
        }
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
    if (this.callbacks.onUpdateBlockText) this.callbacks.onUpdateBlockText(containerId, blockIndex, delta as DocBlockText, transaction.local);
  };

  private handleBlockDataChanged = (event: Y.YMapEvent<BlockDataType>, transaction: Y.Transaction) => {
    //
    const delta: DocBlockDelta = {
      insert: {},
      delete: [],
    };
    //
    const path = event.path;
    const [allBlocks, containerId, blockIndex] = path;
    assert(allBlocks === 'blocks', `invalid event path: ${path}`);
    assert(typeof containerId === 'string', `invalid event path: ${path}`);
    assert(typeof blockIndex === 'number', `invalid event path: ${path}`);

    event.changes.keys.forEach((change, key) => {
      const blockData = this.getBlockData(containerId, blockIndex);
      if (change.action === 'add') {
        delta.insert[key] = blockData[key];
        assert(delta.insert[key] !== undefined, `no data after update: ${key}, ${JSON.stringify(blockData)}`);
      } else if (change.action === 'update') {
        delta.delete.push(key);
        delta.insert[key] = blockData[key];
        assert(delta.insert[key] !== undefined, `no data after update: ${key}, ${JSON.stringify(blockData)}`);
      } else if (change.action === 'delete') {
        delta.delete.push(key);
      }
    });
    //
    assert(this.callbacks, 'no callbacks registered');
    if (this.callbacks.onUpdateBlockData) this.callbacks.onUpdateBlockData(containerId, blockIndex, delta, transaction.local);
  };

  private handleBlocksChanged = (event: Y.YArrayEvent<Y.Map<unknown>>, transaction: Y.Transaction) => {
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
          if (this.callbacks.onInsertBlock) this.callbacks.onInsertBlock(containerId, blockIndex, this.mapToBlockData(b), transaction.local);
        }
      }
      if (op.delete) {
        for (let deletedIndex = op.delete - 1; deletedIndex >= 0; deletedIndex--) {
          const deleteBlockIndex = blockIndex + deletedIndex;
          if (this.callbacks.onDeleteBlock) this.callbacks.onDeleteBlock(containerId, deleteBlockIndex, transaction.local);
        }
      }
    }
  };

  handleChildContainerChanged(event: Y.YMapEvent<BlocksType>, transaction: Y.Transaction) {
    event.changes.keys.forEach((change, key) => {
      assert(this.callbacks, 'no callbacks registered');
      if (change.action === 'add') {
        const blocks = this.getContainerBlocks(key);
        if (this.callbacks.onInsertChildContainer) this.callbacks.onInsertChildContainer(key, blocks, transaction.local);
      } else if (change.action === 'update') {
        assert(false, 'should not update container data');
      } else if (change.action === 'delete') {
        if (this.callbacks.onDeleteChildContainer) this.callbacks.onDeleteChildContainer(key, transaction.local);
      }
    });
  }

  private mapToBlockData(map: BlockDataType): DocBlock {
    const json = map.toJSON();
    if (map.has('text')) {
      const blockText = map.get('text') as unknown as Y.Text;
      assert(blockText instanceof Y.Text, `invalid text type, ${typeof blockText}`);
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

  private blocksMapToBlocks(blocksData: BlocksType) {
    const blocks = blocksData.map((b) => this.mapToBlockData(b));
    return blocks;
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

  private getBlockMap(containerId: string, blockIndex: number): BlockDataType {
    const block = this.getContainerBlocksMap(containerId).get(blockIndex);
    assert(block, `no block in container: ${containerId}, ${blockIndex}`);
    return block;
  }

  getContainerBlocks(containerId: string): DocBlock[] {
    const blocksData = this.getContainerBlocksMap(containerId);
    return this.blocksMapToBlocks(blocksData);
  }

  getBlockData(containerId: string, blockIndex: number): DocBlock {
    const blocksData = this.getContainerBlocksMap(containerId);
    const blockData = blocksData.get(blockIndex);
    assert(blockData, `no block data: ${blockIndex}`);
    const json = blockData.toJSON();
    const blockText = blockData.get('text') as unknown as Y.Text;
    if (blockText) {
      assert(blockText instanceof Y.Text, `invalid block text type: ${JSON.stringify(blockText)}`);
      json.text = blockText.toDelta();
    }
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
    const blockMap = this.getBlockMap(containerId, blockIndex);
    const oldBlockData = this.mapToBlockData(blockMap);
    //
    const convertValue = (key: string, value: unknown) => {
      //
      if (key !== 'text') {
        return value;
      }
      //
      assert(Array.isArray(value), `invalid text type: ${JSON.stringify(value)}`);
      const text = new Y.Text();
      text.applyDelta(value);
      return text;
    };
    //
    const deletedKeys = new Set(delta.delete);
    Object.entries(delta.insert).forEach(([key, value]) => {
      if (deletedKeys.has(key)) {
        // update
        blockMap.set(key, convertValue(key, value));
        deletedKeys.delete(key);
      } else {
        // insert
        blockMap.set(key, convertValue(key, value));
      }
    });
    //
    deletedKeys.forEach((key) => {
      // delete
      blockMap.delete(key);
    });
    //
    return oldBlockData;
  }

  localInsertChildContainer(containerId: string, blocks: DocBlock[]): void {
    const allBlocksMap = this.getAllBlocksMap();
    assert(!allBlocksMap.has(containerId), `child container has already exists: ${containerId}`);
    const blocksArray = new Y.Array<BlockDataType>();
    blocksArray.push(blocks.map((b) => this.blockDataToMap(b)));
    allBlocksMap.set(containerId, blocksArray);
  }

  localDeleteChildContainers(containerIds: string[]): void {
    const allBlocksMap = this.getAllBlocksMap();
    containerIds.forEach((containerId) => {
      assert(allBlocksMap.has(containerId), `child container has already exists: ${containerId}`);
      allBlocksMap.delete(containerId);
    });
  }
}
