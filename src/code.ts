import mapping from './componentMapping.json';

const webToApp: Record<string, string> = mapping.webToApp;
const appToWeb: Record<string, string> = mapping.appToWeb;

type direction = 'to-web' | 'to-app';
type VariantProps = Record<string, string | boolean | VariableAlias>;
interface OverrideSnapshot {
  variantProps: VariantProps;
  textOverrides: Map<string, string>;
  paintOverrides: Map<string, Paint[]>;
  effectOverrides: Map<string, Effect[]>
}

const loadedFonts = new Set<string>();
const uiSettings =  { width: 700, height: 500};



function exportLibrary() {
  figma.loadAllPagesAsync();
  const components = figma.root.findAllWithCriteria({ types: ['COMPONENT'] }).filter(c => c.parent && c.parent.type !== 'COMPONENT_SET');
  const componentSets = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET'] });

  const componentList = [
    ...components.map(c => ({ type: 'COMPONENT' as const, name: c.name, key: c.key})),
    ...componentSets.map(s => ({ type: 'COMPONENT_SET' as const, name: s.name, key: s.key}))
  ];

  figma.ui.postMessage({ type: 'export-data', payload: componentList});
}

function findArtboard(node: SceneNode, cache: Map<string, FrameNode | null>): FrameNode | null {
  if (cache.has(node.id)) {
    return cache.get(node.id)!;
  }

  const visited: BaseNode[] = [];
  let cursor: BaseNode | null = node;
  let found: FrameNode | null = null;

  while(cursor) {
    visited.push(cursor);
    if (cursor.type === 'FRAME' && cursor.parent === figma.currentPage) {
      found = cursor as FrameNode;
      break;
    }

    cursor = cursor.parent;
  }

  for (const node of visited) {
    cache.set(node.id, found);
  }

  return found;
}

function getFrames(): FrameNode[] {

  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.notify("You must select at least one element");
    throw new Error("Nothing selected");
  }

  const cache = new Map<string, FrameNode | null>();
  const artboards = new Set<FrameNode>();

  for (const node of selection) {
    const artboard = findArtboard(node, cache);

    if (!artboard) {
      figma.notify(`${node.name} isn't inside an artboard.`);
      throw new Error(`${node.name} isn't inside an artboard.`);
    }

    artboards.add(artboard);
  }

  return Array.from(artboards);

}

function duplicateFrames(frames: FrameNode[], direction:direction): FrameNode[] {
  const clones: FrameNode[] = [];

  for (const original of frames) {
    const clone = original.clone() as FrameNode;
    figma.currentPage.appendChild(clone);
    clone.x = original.x + original.width + 50;
    clone.y = original.y;

    clone.name = `${original.name} - ${(direction === 'to-app') ? `app` : `web`}`;
    clones.push(clone);
  } 

  return clones;
}

function captureOverrides(instance: InstanceNode): OverrideSnapshot {

  const variantProps: Record<string, string | boolean | VariableAlias> = {};

  for (const propName in instance.componentProperties) {
    variantProps[propName] = instance.componentProperties[propName].value;
  }

  const textOverrides = new Map<string, string>();
  const paintOverrides = new Map<string, Paint[]>();
  const effectOverrides = new Map<string, Effect[]>();

  const walk = (node: SceneNode) => {
    if (node.type === 'TEXT') {
      textOverrides.set(node.id, node.characters);
    }
    if ('fills' in node) {
      paintOverrides.set(node.id, node.fills as Paint[]);
    }
    if ('effects' in node) {
      effectOverrides.set(node.id, node.effects as Effect[]);
    }
    if ('children' in node) {
      for (const child of node.children) walk(child);
    }
  };

  for (const child of instance.children) walk(child);

  return { variantProps, textOverrides, paintOverrides, effectOverrides };
}

async function loadFonts(node: TextNode) {
  const font = node.fontName as FontName;
  const key = `${font.family}---${font.style}`;

  if (!loadedFonts.has(key)) {
    await figma.loadFontAsync(font);
    loadedFonts.add(key);
  }
}

async function applyOverrides(instance: InstanceNode, snapshot: OverrideSnapshot) {

  const allowed = instance.componentProperties;
  const filteredProps:VariantProps = {};

  for (const propName  in snapshot.variantProps) {
    if (allowed[propName] !== undefined) {
      filteredProps[propName] = snapshot.variantProps[propName];
    }
  }

  // set variant properties
  try {
    instance.setProperties(filteredProps);
  } catch (e:any) {
    console.log(instance.name);
    console.log(allowed);
    console.log(filteredProps);
    throw new Error("Issue setting properties.");
  }


  //set overrides
  const walk = async (node: SceneNode) => {
    if (node.type === 'TEXT' && snapshot.textOverrides.has(node.id)) {
      await loadFonts(node);
      node.characters = snapshot.textOverrides.get(node.id)!;
    }
    if ('fills' in node && snapshot.paintOverrides.has(node.id)) {
      node.fills = snapshot.paintOverrides.get(node.id)!;
    }
    if ('effects' in node && snapshot.effectOverrides.has(node.id)) {
      (node as any).effects = snapshot.effectOverrides.get(node.id)!;
    }
    if ('children' in node) {
      for (const child of node.children) await walk(child);
    }
  };

  for (const child of instance.children) {
    await walk(child);
  }
}

function findBestVariant(setNode: ComponentSetNode, sourceProps: Record<string, string | boolean | VariableAlias>): ComponentNode {
  const setVariants = setNode.children as ComponentNode[];

  // 1. Exact Match
  for (const variant of setVariants) {
    const vp = variant.variantProperties;

    if (!vp || Object.keys(vp).length !== Object.keys(sourceProps).length) {
      continue;
    }

    let allMatch = true;
    for (const key in sourceProps) {
      if (vp[key] !== sourceProps[key]) {
        allMatch = false;
        break;
      }
    }
    if (allMatch){
      console.log("full match found");
      return variant;
    }
  }

  // 2. Partial match scoring
  let best = setVariants[0];
  let bestScore = -1;

  for (const variant of setVariants) {
    const vp = variant.variantProperties;
    let score = 0;

    if (!vp) {
      continue;
    }

    for (const key in sourceProps) {
      if (vp[key] === sourceProps[key]) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  }

  //3. Return best variant or fallback
  return best;
}

async function swapInstances(artboard: FrameNode, direction:direction) {
  const errorLog: {
    instanceId: string;
    //instanceName: string;
    componentName: string | undefined;
    componentKey: string | undefined;
    stage: string;
    errorMessage: string;
  }[] = [];

  const lookup: Record<string,string> =
    direction === 'to-app'
    ? (mapping.webToApp as Record<string,string>)
    : (mapping.appToWeb as Record<string,string>);

  const missingKeys: string[] = [];
  const instances = artboard.findAll(n => n.type === 'INSTANCE') as InstanceNode[];

  for (const inst of instances) {
    let snapshot: OverrideSnapshot;

    try {
      snapshot = captureOverrides(inst);
    } catch (e:any) {
      errorLog.push({
        instanceId:    inst.id,
        //instanceName:  inst.name,
        componentName: undefined,
        componentKey:  undefined,
        stage:         'capture',
        errorMessage:  e.message,
      });
      continue;
    }

    let mainComp: ComponentNode | null = null;
    let sourceName = 'unknown';
    try {
      mainComp = await inst.getMainComponentAsync();

      if (!mainComp) {
        throw new Error("Could not get Main component for this instance");
      }

      sourceName = mainComp.name;
    } catch (e: any) {
      errorLog.push({
        instanceId:    inst.id,
        //instanceName:  inst.name,
        componentName: undefined,
        componentKey:  undefined,
        stage:         'getMainComponent',
        errorMessage:  e.message,
      });
      continue;
    }

    // Try to map directly with the source key
    const sourceKey = mainComp.key;
    let targetKey = lookup[sourceKey];

    // If no match...
      if (!targetKey) { 
        const parent = mainComp.parent;

        // check if it's a set
        if (parent && parent.type === 'COMPONENT_SET') {
          const setTargetKey = lookup[parent.key];

          // if it matched as a set, import that component set and its variants
          if (setTargetKey) {
            const targetSet = await figma.importComponentSetByKeyAsync(setTargetKey);

            // Determine what's the closest variant match between source and target component
            const bestVariant = findBestVariant(targetSet, snapshot.variantProps);
            targetKey = bestVariant.key;
          }
        }
      }

      // if still no match, continue to next instance
      if (!targetKey) {
        continue;
      }

    let replacement: ComponentNode;
    try {
      replacement = await figma.importComponentByKeyAsync(targetKey);
    } catch (e:any) {
      errorLog.push({
        instanceId:    inst.id,
        //instanceName:  inst.name,
        componentName: (mainComp.parent) ? mainComp.parent.name : sourceName,
        componentKey:  sourceKey,
        stage:         'import replacement component',
        errorMessage:  e.message,
      });
      continue;
    }

    // Swap the component
    try {
      inst.swapComponent(replacement);
    } catch (e:any) {
      errorLog.push({
        instanceId:    inst.id,
        //instanceName:  inst.name,
        componentName: (mainComp.parent) ? mainComp.parent.name : sourceName,
        componentKey:  sourceKey,
        stage:         'swap',
        errorMessage:  e.message,
      });
      continue;
    }

    // Apply overrides
    try {
      await applyOverrides(inst, snapshot);
    } catch (e:any) {
      errorLog.push({
        instanceId:    inst.id,
        //instanceName:  inst.name,
        componentName: (mainComp.parent) ? mainComp.parent.name : sourceName,
        componentKey:  sourceKey,
        stage:         'apply overrides',
        errorMessage:  e.message,
      });
      continue;
    }
    console.log(`✅ swapped “${inst.name}” (${sourceName})`);
  }

  figma.ui.postMessage({type: 'migration-complete', errors: errorLog, direction:direction});
}

async function runMigration(direction:direction) {
  try {
    const frames = getFrames();

    const clonedFrames = duplicateFrames(frames, direction);

    for (const frame of clonedFrames) {
      await swapInstances(frame, direction);
    }
  }
  catch(e) {
    console.error(e);
  }
}

figma.showUI(__html__, uiSettings);

// listen to the plugin init command
switch (figma.command) {
  case 'export-library':
    figma.ui.postMessage({ type: 'init', command: 'export-library'});
    break;
  case 'to-app':
  case 'to-web':
    figma.ui.postMessage({ type: 'init', command: 'run-migration', direction: figma.command});
    break;
}

// Listen for messages from the UI
figma.ui.onmessage = (msg: { type: string }) => {
  console.log("message received");
  switch (msg.type) {
    case 'ui-loaded':
      console.log('ui loaded');
      break;
    case 'close-plugin':
      figma.closePlugin();
      break;
    case 'request-export-data':
      exportLibrary();
      break;
    case 'run-migration':
      runMigration(figma.command as direction);
      break;
  }
};

/*
To-do's:
- Fix passing error log to UI
- Pass succesful swaps log to UI
- Work on optional "experimental" swaps for more complicated components (e.g. carousel)
- Undo cloned artboard in case of fatal error
- deal with instance swaps inside modals
*/