function exportLibrary() {
  const components = figma.root.findAllWithCriteria({ types: ['COMPONENT'] });
  const componentSets = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET'] });

  const componentList = [
    ...components.map(c => ({ type: 'component' as const, name: c.name, key: c.key})),
    ...componentSets      .map(s => ({ type: 'variantSet' as const, name: s.name, key: s.key}))
  ];

  figma.ui.postMessage({ type: 'export-data', payload: componentList});
}

// listen to the plugin init command
if (figma.command === 'export-library') {
  figma.showUI(__html__, { width: 400, height: 300});
  figma.ui.postMessage({ type: 'init', command: 'export-library'});
}

// Listen for messages from the UI
figma.ui.onmessage = (msg: { type: string; direction?: string }) => {
  switch (msg.type) {
    case 'close-plugin':
      figma.closePlugin();
      break;
    case 'run-migration':
      // later: handle msg.direction ('web-to-app' | 'app-to-web')
      break;
    case 'request-export-data':
      exportLibrary();
      break;
    // …and so on
  }
};