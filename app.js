const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const shareButton = document.getElementById('shareButton');
const shareInfo = document.getElementById('shareInfo');
const streamUrl = document.getElementById('streamUrl');

let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let socket = null;
let serverIP = null;
let isHost = false; // Add this at the top with other let declarations

// Initialize the application
async function init() {
    try {
        const currentHost = window.location.hostname;
        const currentPort = '8080';
        
        socket = io(`http://${currentHost}:${currentPort}`);
        
        const connectionStatus = document.getElementById('connectionStatus');
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');

        if (roomId) {
            // This is a viewer
            isHost = false;
            currentRoomId = roomId;
            socket.emit('join-room', roomId);
            
            // Hide controls for viewers
            startButton.style.display = 'none';
            stopButton.style.display = 'none';
            shareButton.style.display = 'none';
            connectionStatus.innerHTML += '<br>Role: Viewer 👀';
        } else {
            // This is a potential host
            isHost = true;
            connectionStatus.innerHTML += '<br>Role: Host 📹';
        }

        setupSocketListeners();
    } catch (error) {
        console.error('Failed to initialize:', error);
        document.getElementById('connectionStatus').textContent = 'Connection failed: ' + error.message;
    }
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
    });

    socket.on('user-connected', async (userId) => {
        console.log('User connected:', userId);
        try {
            // Only start camera if we're the host
            if (isHost) {
                if (!localStream) {
                    await startCamera();
                }
                await initializePeerConnection();
                await createAndSendOffer();
            }
        } catch (error) {
            console.error('Error in user-connected handler:', error);
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Connection failed:', error);
        alert('Failed to connect to server. Please refresh the page.');
    });

    socket.on('offer', handleOffer);

    socket.on('answer', async (answer) => {
        try {
            if (!peerConnection) {
                console.warn('No peer connection when receiving answer');
                return;
            }

            // Check if we can set remote description
            if (peerConnection.signalingState === 'have-local-offer') {
                console.log('Setting remote description (answer)');
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } else {
                console.warn('Cannot set remote description in state:', peerConnection.signalingState);
                // Reset connection if in wrong state
                await initializePeerConnection();
                if (isHost) {
                    await createAndSendOffer();
                }
            }
        } catch (error) {
            console.error('Error setting remote description:', error);
            handleConnectionRetry(error);
        }
    });

    socket.on('ice-candidate', async (candidate) => {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    });

    socket.on('room-full', () => {
        alert('Connection established. You can now share your camera.');
    });

    socket.on('force-disconnect', (reason) => {
        console.log('Disconnected by server:', reason);
        if (peerConnection) {
            peerConnection.close();
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        socket.disconnect();
        alert('Disconnected by server: ' + reason);
    });

    socket.on('console-response', (data) => {
        console.log(data);
    });
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
shareButton.addEventListener('click', shareStream);

async function requestCameraPermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(track => track.stop()); // Stop the test stream
        return true;
    } catch (error) {
        console.error('Permission denied or camera not available:', error);
        return false;
    }
}

async function startCamera() {
    if (!isHost) {
        console.warn('Only hosts can start camera');
        return;
    }

    try {
        // First check if permissions are granted
        const hasPermission = await requestCameraPermission();

        if (!hasPermission) {
            alert('Please allow camera and microphone access to use this app. You might need to reset permissions in your browser settings.');
            return;
        }

        // Now actually get the stream for use
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });
        
        localVideo.srcObject = localStream;
        
        // Add buffer size monitoring
        localVideo.addEventListener('loadedmetadata', () => {
            setInterval(() => {
                if (localVideo.buffered.length > 0) {
                    const bufferedSeconds = localVideo.buffered.end(0) - localVideo.buffered.start(0);
                    console.log('Local Video Buffer Size:', bufferedSeconds.toFixed(2), 'seconds');
                }
            }, 1000);
        });

        // Update button states
        


        startButton.disabled = true;
        stopButton.disabled = false;
        shareButton.disabled = false;
        
        // Add permission status indicator
        const connectionStatus = document.getElementById('connectionStatus');
        connectionStatus.innerHTML += '<br>Camera access: Granted ✅';
        
    } catch (error) {
        console.error('Error accessing camera:', error);
        const connectionStatus = document.getElementById('connectionStatus');
        connectionStatus.innerHTML += '<br>Camera access: Denied ❌';
        alert('Error accessing camera: ' + error.message + '\nPlease make sure you have a camera connected and have granted permission.');
    }
}

function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        startButton.disabled = false;
        stopButton.disabled = true;
        shareButton.disabled = true;
        shareInfo.style.display = 'none';
    }
}

async function initializePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }
    
    peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // Remove viagenie TURN server as it might be unreliable
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10,
        // Add iOS-specific constraints
        sdpSemantics: 'unified-plan',
        iceTransportPolicy: 'all'
    });

    // Add error handling for negotiation needed
    peerConnection.onnegotiationneeded = async () => {
        try {
            if (isHost) {
                await createAndSendOffer();
            }
        } catch (error) {
            console.error('Error during negotiation:', error);
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate:', event.candidate);
            socket.emit('ice-candidate', event.candidate, currentRoomId);
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection State:', peerConnection.connectionState);
    };

    // Add connection state logging
    peerConnection.onsignalingstatechange = () => {
        console.log('Signaling State:', peerConnection.signalingState);
    };

    // Add local tracks to the connection
    if (localStream) {
        console.log('Adding local tracks to peer connection');
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    return peerConnection;
}

async function createAndSendOffer() {
    try {
        // Reset connection if not in stable state
        if (peerConnection.signalingState !== 'stable') {
            await peerConnection.close();
            await initializePeerConnection();
        }

        console.log('Creating offer...');
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            voiceActivityDetection: false // Changed to false for better compatibility
        });
        
        // Wait for stable state before setting local description
        if (peerConnection.signalingState === 'stable') {
            console.log('Setting local description...');
            await peerConnection.setLocalDescription(offer);
            
            console.log('Sending offer to remote peer...');
            socket.emit('offer', offer, currentRoomId);
        } else {
            console.warn('Cannot set local description, wrong state:', peerConnection.signalingState);
        }
    } catch (error) {
        console.error('Error creating/sending offer:', error);
        handleConnectionRetry(error);
    }
}

async function handleOffer(offer) {
    try {
        // Always create new connection when receiving offer
        await initializePeerConnection();
        
        console.log('Setting remote description from offer...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Only create answer if we're in the right state
        if (peerConnection.signalingState === 'have-remote-offer') {
            console.log('Creating answer...');
            const answer = await peerConnection.createAnswer();
            
            console.log('Setting local description...');
            await peerConnection.setLocalDescription(answer);
            
            console.log('Sending answer...');
            socket.emit('answer', answer, currentRoomId);
        } else {
            console.warn('Wrong signaling state for creating answer:', peerConnection.signalingState);
        }
    } catch (error) {
        console.error('Error handling offer:', error);
        handleConnectionRetry(error);
    }
}

// Add stats gathering for RTCPeerConnection
function logPeerConnectionStats() {
    if (peerConnection) {
        peerConnection.getStats().then(stats => {
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.kind === 'video') {
                    console.log('Video Stats:', {
                        bytesReceived: report.bytesReceived,
                        packetsReceived: report.packetsReceived,
                        packetsLost: report.packetsLost,
                        frameWidth: report.frameWidth,
                        frameHeight: report.frameHeight,
                        framesDecoded: report.framesDecoded,
                        framesDropped: report.framesDropped
                    });
                }
            });
        });
    }
}

// Start periodic stats logging
setInterval(logPeerConnectionStats, 2000);

async function shareStream() {
    if (!isHost) {
        alert('Only hosts can share their camera');
        return;
    }

    if (!socket) {
        console.error('Server connection not ready');
        return;
    }

    try {
        if (!localStream) {
            await startCamera();
        }

        currentRoomId = Math.random().toString(36).substring(7);
        const host = window.location.hostname;
        const port = window.location.port || '8080';
        const fullUrl = `http://${host}:${port}?room=${currentRoomId}`;
        
        socket.emit('join-room', currentRoomId);
        streamUrl.textContent = fullUrl;
        shareInfo.style.display = 'block';

        // Initialize peer connection after joining room
        await initializePeerConnection();
    } catch (error) {
        console.error('Error sharing stream:', error);
        alert('Failed to start sharing. Please try again.');
    }
}

// Add this function to handle connection retries
function handleConnectionRetry(error) {
    console.warn('Connection error, retrying:', error);
    if (peerConnection) {
        peerConnection.close();
    }
    setTimeout(async () => {
        await initializePeerConnection();
        if (isHost) {
            await createAndSendOffer();
        }
    }, 2000);
}

// Initialize on page load
window.addEventListener('load', () => {
    init();
    
    // Hide all controls initially for viewers
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    
    if (roomId) {
        startButton.style.display = 'none';
        stopButton.style.display = 'none';
        shareButton.style.display = 'none';
    }
});

// Clean up when leaving
window.onbeforeunload = () => {
    if (peerConnection) {
        peerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
};
