interface InitMessage {
    type:'init';
    command: 'export-library' | 'migrate';
}

interface ExportDataMessage {
    type: 'export-data';
    payload: Array<{ type: string; name: string; key: string }>;
}

type UIRequest = 
    | { type: 'request-export-data' }
    | { type: 'run-migration'; direction: 'web-to-app' | 'app-to-web' }
    | { type: 'close-plugin' };

window.onmessage = (event: MessageEvent<{ pluginMessage: InitMessage | ExportDataMessage }>) => {
    const msg = event.data.pluginMessage;
    const container = document.getElementById('content')!;  

    // initialize routines
    if (msg.type === 'init') {

        // export component data command
        if (msg.command === 'export-library') {
            container.innerHTML = `
                <p>Copy the JSON of all local components & variant sets below:</p>
                <textarea id="output" readonly></textarea><br/>
            `;

            parent.postMessage({ pluginMessage: { type: 'request-export-data'} }, '*');
        }
    }

    // output component data
    if (msg.type === 'export-data') {
        const data = (msg as ExportDataMessage).payload;
        const ta = document.getElementById('output') as HTMLTextAreaElement;
        ta.value = JSON.stringify(data, null, 2);
    }
};

// close button
document.getElementById('close')!.addEventListener('click', () => {
    parent.postMessage({ pluginMessage: { type: 'close-plugin'} }, '*');
});