import * as Y from 'yjs';
import { DocBlock, DocBlockText, NextEditorDoc, NextEditorDocCallbacks, assert, DocBlockTextActions, DocObject } from '@nexteditorjs/nexteditor-core';

export type YjsDocData = {
  blocks: DocBlock[];
} & {
  [index: string]: DocBlock[];
};

export default class YjsDoc implements NextEditorDoc {
  doc: Y.Map<string>;

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
      if (key === 'meta' || key === 'comments') {
        obj[key] = value.toJSON();
      } else {
        //
        const arr: DocBlock[] = [];
        // value.isArray();
        assert(value instanceof Y.Array);
        value.forEach((v) => {
          arr.push(this.mapToBlockData(v));
        });
        //
        obj[key] = arr;
      }
    });
    //
    return obj as DocObject;
  }

  registerCallbacks(callbacks: NextEditorDocCallbacks): void {
    this.callbacks = callbacks;
  }

  private handleDocUpdated = (events: Y.YEvent[], transaction: Y.Transaction) => {
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
    assert(path.length === 3, 'invalid text event path');
    const [containerId, blockIndex, textKey] = path;
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
    assert(path.length === 1, 'invalid container event path');
    const [containerId] = path;
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

  private mapToBlockData(map: Y.Map<unknown>): DocBlock {
    const json = map.toJSON();
    if (map.has('text')) {
      const blockText = map.get('text') as unknown as Y.Text;
      json.text = blockText.toDelta();
    }
    return json;
  }

  private blockDataToMap(data: DocBlock): Y.Map<unknown> {
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

  getContainerBlocks(containerId: string): DocBlock[] {
    const blocksData = this.doc.get(containerId) as unknown as Y.Array<Y.Map<unknown>>;
    const blocks = blocksData.map((b) => this.mapToBlockData(b as unknown as Y.Map<unknown>));
    return blocks;
  }

  getBlockData(containerId: string, blockIndex: number): DocBlock {
    const blocksData = this.doc.get(containerId) as unknown as Y.Array<Y.Map<unknown>>;
    const blockData = blocksData.get(blockIndex) as unknown as Y.Map<unknown>;
    assert(blockData, `no block data: ${blockIndex}`);
    const json = blockData.toJSON();
    const blockText = blockData.get('text') as unknown as Y.Text;
    json.text = blockText.toDelta();
    return json;
  }

  localUpdateBlockText(containerId: string, blockIndex: number, deltaOps: DocBlockTextActions): DocBlockText {
    const blocksData = this.doc.get(containerId) as unknown as Y.Array<Y.Map<unknown>>;
    const blockData = blocksData.get(blockIndex) as unknown as Y.Map<unknown>;
    assert(blockData, `no block data: ${blockIndex}`);
    const oldText = blockData.get('text') as unknown as Y.Text;
    oldText.applyDelta(deltaOps);
    return oldText.toDelta();
  }

  localInsertBlock(containerId: string, blockIndex: number, data: DocBlock): DocBlock {
    const blocksData = this.doc.get(containerId) as unknown as Y.Array<Y.Map<unknown>>;
    const obj = this.blockDataToMap(data);
    blocksData.insert(blockIndex, [obj]);
    return data;
  }

  localDeleteBlock(containerId: string, blockIndex: number): DocBlock {
    const blocksData = this.doc.get(containerId) as unknown as Y.Array<Y.Map<unknown>>;
    const data = blocksData.get(blockIndex);
    const obj = this.mapToBlockData(data);
    blocksData.delete(blockIndex);
    return obj;
  }
}
