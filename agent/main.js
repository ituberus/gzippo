import { base64ToBlob, checkForAudioTracks, createConfig, getAudioStream, getSupportedMimeType, VoiceClient, } from '@humeai/voice';
function getElementById(id) {
    const element = document.getElementById(id);
    return element;
}
(async () => {
    // Elements
    const initialScreen = getElementById('initial-screen');
    const callScreen = getElementById('call-screen');
    const startCallBtn = getElementById('start-call-btn');
    const endCallBtn = getElementById('end-call-btn');
    const muteBtn = getElementById('mute-btn');
    const statusText = getElementById('status-text');
    const callTime = getElementById('call-time');
    const chat = getElementById('chat'); // Conversation box
    const agentTitle = getElementById('agent-title');
    const agentDescription = getElementById('agent-description');
    const descriptionTooltip = getElementById('description-tooltip');
    const infoIcon = getElementById('info-icon');
    // State variables
    const audioQueue = [];
    const result = getSupportedMimeType();
    const mimeType = result.success ? result.mimeType : 'audio/webm';
    let accessToken = '';
    let client = null;
    let isPlaying = false;
    let currentAudio = null;
    let audioStream = null;
    let recorder = null;
    let isCallActive = false;
    let isMuted = false;
    let callDuration = 0;
    let callTimer = null;
    let currentAgent = null;
    // Event Listeners
    startCallBtn?.addEventListener('click', startCallFlow);
    endCallBtn?.addEventListener('click', endCall);
    muteBtn?.addEventListener('click', toggleMute);
    infoIcon?.addEventListener('mouseenter', () => {
        if (descriptionTooltip && currentAgent) {
            descriptionTooltip.textContent = currentAgent.description;
            descriptionTooltip.style.display = 'block';
        }
    });
    infoIcon?.addEventListener('mouseleave', () => {
        if (descriptionTooltip) {
            descriptionTooltip.style.display = 'none';
        }
    });
    // Initialize on page load
    window.addEventListener('load', initializeAgent);
    async function initializeAgent() {
        let ref = null;
        // First, try to get 'ref' from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        ref = urlParams.get('ref');
        if (!ref) {
            // If 'ref' is not in URL parameters, try to get it from the referrer
            const referer = document.referrer; // E.g., "https://google.com/nile"
            if (referer) {
                try {
                    const refererUrl = new URL(referer);
                    const pathSegments = refererUrl.pathname.split('/').filter(segment => segment.length > 0);
                    if (pathSegments.length > 0) {
                        ref = pathSegments[pathSegments.length - 1]; // Gets the last segment, e.g., "nile"
                        console.log(`Referrer detected. Extracted ref: ${ref}`);
                    }
                    else {
                        console.warn('Referrer URL does not contain path segments. Redirecting to agents.');
                    }
                }
                catch (error) {
                    console.error('Invalid referrer URL:', error);
                }
            }
            else {
                console.warn('No referrer detected.');
            }
        }
        else {
            console.log(`Ref found in URL parameters: ${ref}`);
        }
        if (!ref) {
            console.warn('No ref found in URL parameters or referrer. Redirecting to agents.');
            redirectToAgents();
            return;
        }
        try {
            const agent = await fetchAgentConfig(ref);
            if (!agent) {
                console.warn(`No matching agent found for ref: ${ref}`);
                redirectToAgents();
                return;
            }
            currentAgent = agent;
            updateUIWithAgentInfo(agent);
            console.log('Agent loaded successfully:', agent);
        }
        catch (error) {
            console.error('Error initializing agent:', error);
            redirectToAgents();
        }
    }
    async function fetchAgentConfig(ref) {
        try {
            // Replace with your actual API endpoint
            const response = await fetch(`https://gzippo-production.up.railway.app/api/agents/${encodeURIComponent(ref)}`);
            if (!response.ok) {
                console.error(`Failed to fetch agent: ${response.statusText}`);
                return null;
            }
            const result = await response.json();
            return result.agent || null;
        }
        catch (error) {
            console.error('Error fetching agent config:', error);
            return null;
        }
    }
    function updateUIWithAgentInfo(agent) {
        if (agentTitle) {
            agentTitle.textContent = agent.name;
        }
        if (agentDescription) {
            agentDescription.textContent = agent.description || 'No description provided.';
        }
        if (agent.icon) {
            const avatarIcon = initialScreen?.querySelector('.avatar .material-icons-round');
            if (avatarIcon) {
                avatarIcon.textContent = ''; // Clear existing icon
                const img = document.createElement('img');
                img.src = agent.icon;
                img.alt = `${agent.name} Icon`;
                img.style.width = '48px';
                img.style.height = '48px';
                avatarIcon.parentElement?.appendChild(img);
            }
        }
    }
    function redirectToAgents() {
        // Implement your redirection logic here
        window.location.href = '/agents'; // Example redirection
    }
    function updateCallTime() {
        if (callTime) {
            const minutes = Math.floor(callDuration / 60);
            const seconds = callDuration % 60;
            callTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    function toggleMute() {
        if (!audioStream)
            return;
        isMuted = !isMuted;
        audioStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
        if (muteBtn) {
            muteBtn.innerHTML = isMuted ?
                '<span class="material-icons-round">mic_off</span>' :
                '<span class="material-icons-round">mic</span>';
            muteBtn.classList.toggle('muted', isMuted);
        }
    }
    async function startCallFlow() {
        if (!currentAgent) {
            console.error('No agent configuration found');
            return;
        }
        if (initialScreen && callScreen) {
            initialScreen.style.display = 'none';
            callScreen.style.display = 'flex';
            // **Hide the conversation/chat box during the call**
            if (chat) {
                chat.style.display = 'none'; // Hide chat during call
            }
        }
        if (statusText) {
            statusText.textContent = 'Connecting...';
            statusText.classList.add('loading');
        }
        try {
            await authenticate();
            await connect();
            // To stabilize the connection, disconnect and reconnect as per the second code
            await disconnect();
            await connect();
            isCallActive = true;
            if (statusText) {
                statusText.textContent = 'Listening...';
                statusText.classList.remove('loading');
            }
            if (callTime) {
                callTime.style.display = 'block';
            }
            // Start call timer
            callDuration = 0;
            callTimer = window.setInterval(() => {
                callDuration++;
                updateCallTime();
            }, 1000);
        }
        catch (error) {
            console.error('Error in start call flow:', error);
            endCall();
        }
    }
    async function endCall() {
        await disconnect();
        isCallActive = false;
        if (initialScreen && callScreen) {
            initialScreen.style.display = 'flex';
            callScreen.style.display = 'none';
            // **Ensure chat remains hidden after the call ends**
            if (chat) {
                chat.style.display = 'none'; // Hide chat after call
            }
        }
        if (callTimer) {
            clearInterval(callTimer);
            callTimer = null;
        }
        // Reset call duration
        callDuration = 0;
        updateCallTime();
        // Reset mute state
        isMuted = false;
        if (muteBtn) {
            muteBtn.innerHTML = '<span class="material-icons-round">mic</span>';
            muteBtn.classList.remove('muted');
        }
        // Reset status text
        if (statusText) {
            statusText.textContent = '';
            statusText.classList.remove('loading');
        }
    }
    async function authenticate() {
        if (!currentAgent) {
            throw new Error('No agent configuration found');
        }
        const apiKey = import.meta.env.VITE_HUME_API_KEY || '';
        const clientSecret = import.meta.env.VITE_HUME_CLIENT_SECRET || '';
        if (!apiKey || !clientSecret) {
            throw new Error('Hume API key or client secret is missing.');
        }
        const authString = `${apiKey}:${clientSecret}`;
        const encoded = btoa(authString);
        try {
            const res = await fetch('https://api.hume.ai/oauth2-cc/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${encoded}`,
                },
                body: new URLSearchParams({
                    grant_type: 'client_credentials',
                }).toString(),
                cache: 'no-cache',
            });
            if (!res.ok) {
                throw new Error(`Authentication failed: ${res.statusText}`);
            }
            const data = await res.json();
            accessToken = String(data['access_token']);
        }
        catch (e) {
            console.error('Failed to authenticate:', e);
            throw e;
        }
    }
    async function connect() {
        return new Promise((resolve, reject) => {
            try {
                const config = createConfig({
                    auth: {
                        type: 'accessToken',
                        value: accessToken,
                    },
                });
                client = VoiceClient.create(config);
                client.on('open', async () => {
                    console.log('WebSocket connection opened');
                    await captureAudio();
                    resolve();
                });
                client.on('message', async (message) => {
                    switch (message.type) {
                        case 'user_message':
                        case 'assistant_message':
                            const { role, content } = message.message;
                            appendMessage(role, content);
                            if (role === 'assistant' && statusText) {
                                statusText.textContent = 'Speaking...';
                            }
                            break;
                        case 'audio_output':
                            const audioOutput = message.data;
                            const blob = base64ToBlob(audioOutput, mimeType);
                            audioQueue.push(blob);
                            if (audioQueue.length === 1) {
                                await playAudio();
                            }
                            break;
                        case 'user_interruption':
                            stopAudio();
                            break;
                        default:
                            console.warn('Unknown message type:', message.type);
                    }
                });
                client.on('close', () => {
                    console.log('WebSocket connection closed.');
                    if (statusText && isCallActive) {
                        statusText.textContent = 'Listening...';
                    }
                });
                client.connect();
            }
            catch (error) {
                console.error('Error in connect:', error);
                reject(error);
            }
        });
    }
    async function disconnect() {
        return new Promise((resolve) => {
            stopAudio();
            recorder?.stop();
            recorder = null;
            audioStream = null;
            client?.disconnect();
            appendMessage('system', 'Conversation ended.');
            resolve();
        });
    }
    async function captureAudio() {
        try {
            audioStream = await getAudioStream();
            checkForAudioTracks(audioStream);
            recorder = new MediaRecorder(audioStream, { mimeType });
            recorder.ondataavailable = async ({ data }) => {
                if (data.size > 0 && client?.readyState === WebSocket.OPEN && !isMuted) {
                    const buffer = await data.arrayBuffer();
                    client?.sendAudio(buffer);
                }
            };
            recorder.start(100);
        }
        catch (error) {
            console.error('Error capturing audio:', error);
            throw error;
        }
    }
    async function playAudio() {
        if (audioQueue.length > 0 && !isPlaying) {
            isPlaying = true;
            const audioBlob = audioQueue.shift();
            if (audioBlob) {
                const audioUrl = URL.createObjectURL(audioBlob);
                currentAudio = new Audio(audioUrl);
                currentAudio.play();
                currentAudio.onended = () => {
                    isPlaying = false;
                    if (audioQueue.length) {
                        playAudio();
                    }
                    else if (statusText && isCallActive) {
                        statusText.textContent = 'Listening...';
                    }
                    URL.revokeObjectURL(audioUrl);
                };
                currentAudio.onerror = (e) => {
                    console.error('Error playing audio:', e);
                    isPlaying = false;
                    URL.revokeObjectURL(audioUrl);
                };
            }
        }
    }
    function stopAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
        isPlaying = false;
        audioQueue.length = 0;
    }
    function appendMessage(role, content) {
        if (!chat)
            return;
        const timestamp = new Date().toLocaleTimeString();
        const messageEl = document.createElement('p');
        messageEl.innerHTML = `<strong>[${timestamp}] ${capitalizeFirstLetter(role)}:</strong> ${sanitizeContent(content)}`;
        chat.appendChild(messageEl);
        // Auto-scroll to bottom
        chat.scrollTop = chat.scrollHeight;
    }
    function capitalizeFirstLetter(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    function sanitizeContent(content) {
        const div = document.createElement('div');
        div.textContent = content;
        return div.innerHTML;
    }
})();
