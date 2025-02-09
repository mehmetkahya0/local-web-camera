const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const shareButton = document.getElementById('shareButton');
const shareInfo = document.getElementById('shareInfo');
const streamUrl = document.getElementById('streamUrl');
const statsButton = document.getElementById('statsButton'); // Add this line

let localStream = null;
let peerConnection = null;
let currentRoomId = null;
let socket = null;
let serverIP = null;
let isHost = false; // Add this at the top with other let declarations
let statsChart = null; // Add this line
let statsInterval = null; // Add this line
let isStatsVisible = false; // Add this line

// Add this function near the top of the file
async function tryPlayVideo(videoElement) {
    try {
        if (videoElement.paused) {
            // iOS specific attributes
            videoElement.setAttribute('playsinline', '');
            videoElement.setAttribute('webkit-playsinline', '');
            
            // Try playing with different options
            try {
                await videoElement.play();
                console.log('Video playback started successfully');
            } catch (e) {
                console.warn('Playback failed, trying with muted:', e);
                videoElement.muted = true;
                await videoElement.play();
                
                // Add unmute button with iOS-friendly styling
                if (!document.getElementById('unmuteButton')) {
                    const unmuteButton = document.createElement('button');
                    unmuteButton.id = 'unmuteButton';
                    unmuteButton.textContent = 'Tap to Unmute';
                    unmuteButton.style.position = 'fixed';
                    unmuteButton.style.bottom = '40px';
                    unmuteButton.style.left = '50%';
                    unmuteButton.style.transform = 'translateX(-50%)';
                    unmuteButton.style.zIndex = '1000';
                    unmuteButton.style.padding = '12px 24px';
                    unmuteButton.style.backgroundColor = '#007AFF';
                    unmuteButton.style.color = 'white';
                    unmuteButton.style.border = 'none';
                    unmuteButton.style.borderRadius = '20px';
                    unmuteButton.onclick = () => {
                        videoElement.muted = false;
                        unmuteButton.remove();
                    };
                    document.body.appendChild(unmuteButton);
                }
            }
        }
    } catch (error) {
        console.error('Final playback attempt failed:', error);
    }
}

// Initialize the application
async function init() {
    try {
        // Use window.location.hostname instead of localhost
        const currentHost = window.location.hostname;
        const currentPort = '8080';
        
        // Log connection details for debugging
        console.log('Connecting to:', `http://${currentHost}:${currentPort}`);
        
        socket = io(`http://${currentHost}:${currentPort}`, {
            reconnection: true,
            reconnectionAttempts: 5,
            timeout: 10000,
            transports: ['websocket', 'polling']
        });
        
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
statsButton.addEventListener('click', () => { // Add this block
    console.log('Stats button clicked');
    isStatsVisible = !isStatsVisible;
    const statsOverlay = document.getElementById('stats-overlay');
    const statsButton = document.getElementById('statsButton');
    
    statsOverlay.style.display = isStatsVisible ? 'block' : 'none';
    statsButton.classList.toggle('active');
    
    if (isStatsVisible && peerConnection) {
        console.log('Initializing stats...');
        if (!statsChart) {
            initializeStatsGraph();
        }
        // Start stats collection
        if (!statsInterval) {
            statsInterval = setInterval(() => {
                updateStats(peerConnection);
            }, 1000);
        }
    } else {
        console.log('Stopping stats...');
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
    }
});

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
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) {
            alert('Please allow camera and microphone access to use this app.');
            return;
        }

        // More specific video constraints for better compatibility
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        // Add video element event listeners
        localVideo.srcObject = localStream;
        tryPlayVideo(localVideo);
        
        // Verify video tracks
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            console.log('Video track settings:', videoTrack.getSettings());
            videoTrack.onended = () => {
                console.log('Video track ended');
                stopCamera();
            };
        } else {
            throw new Error('No video track available');
        }

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
    
    const configuration = {
        iceServers: [
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            {
                urls: 'turn:numb.viagenie.ca',
                username: 'webrtc@live.com',
                credential: 'muazkh'
            }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 2
    };

    peerConnection = new RTCPeerConnection(configuration);

    // Add video element event listeners for remote video
    remoteVideo.onloadedmetadata = () => {
        console.log('Remote video metadata loaded');
        remoteVideo.play().catch(e => console.error('Error playing remote video:', e));
    };

    remoteVideo.onplay = () => console.log('Remote video playing');
    remoteVideo.onerror = (e) => console.error('Remote video error:', e);

    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        if (event.track.kind === 'video') {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.onloadedmetadata = async () => {
                console.log('Remote video metadata loaded');
                await tryPlayVideo(remoteVideo);
            };
        }
    };

    // Monitor connection state
    let iceConnectionTimeout;
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        const connectionStatus = document.getElementById('connectionStatus');
        
        // Clear existing timeout if any
        if (iceConnectionTimeout) {
            clearTimeout(iceConnectionTimeout);
        }

        // Set new timeout for checking state
        iceConnectionTimeout = setTimeout(() => {
            if (peerConnection.iceConnectionState === 'checking') {
                console.log('Connection timeout - retrying');
                handleConnectionRetry(new Error('ICE timeout'));
            }
        }, 10000); // 10 second timeout

        // Update status with timestamp
        const now = new Date().toLocaleTimeString();
        connectionStatus.innerHTML += `<br>[${now}] Connection: ${peerConnection.iceConnectionState}`;
        
        if (peerConnection.iceConnectionState === 'connected') {
            clearTimeout(iceConnectionTimeout);
            connectionStatus.innerHTML += ' ✅';
        } else if (peerConnection.iceConnectionState === 'failed' || 
                   peerConnection.iceConnectionState === 'disconnected') {
            connectionStatus.innerHTML += ' ❌';
            handleConnectionRetry(new Error('ICE connection failed'));
        }
    };

    // Monitor ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
        console.log('ICE Gathering State:', peerConnection.iceGatheringState);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate:', event.candidate);
            socket.emit('ice-candidate', event.candidate, currentRoomId);
        }
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
        const fullUrl = `http://192.168.HOST_DEVICE_IP:${port}?room=${currentRoomId}`;
        
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
    const connectionStatus = document.getElementById('connectionStatus');
    connectionStatus.innerHTML += '<br>⚠️ Connection issue - attempting to reconnect...';

    if (peerConnection) {
        peerConnection.close();
    }

    setTimeout(async () => {
        await initializePeerConnection();
        if (isHost) {
            await createAndSendOffer();
        }
        connectionStatus.innerHTML += '<br>🔄 Reconnection attempt made';
    }, 2000);
}

// Add this function to check stream status
function checkStreamStatus() {
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`${track.kind} track:`, {
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            });
        });
    }
}

// Call checkStreamStatus periodically
setInterval(checkStreamStatus, 5000);

// Add connection status monitoring
function monitorConnection() {
    if (peerConnection) {
        console.log({
            iceConnectionState: peerConnection.iceConnectionState,
            connectionState: peerConnection.connectionState,
            signalingState: peerConnection.signalingState,
            iceGatheringState: peerConnection.iceGatheringState
        });
    }
}

// Monitor connection every 5 seconds
setInterval(monitorConnection, 5000);

// Add this new function to handle mobile-specific setup
function setupMobileConnection() {
    // Request wake lock to prevent sleep
    try {
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen')
                .then(lock => console.log('Wake Lock active'))
                .catch(err => console.log('Wake Lock error:', err));
        }
    } catch (err) {
        console.log('Wake Lock not supported');
    }

    // Add visible connection status for mobile
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        const connectionStatus = document.getElementById('connectionStatus');
        connectionStatus.style.position = 'fixed';
        connectionStatus.style.bottom = '80px';
        connectionStatus.style.left = '0';
        connectionStatus.style.right = '0';
        connectionStatus.style.backgroundColor = 'rgba(0,0,0,0.7)';
        connectionStatus.style.color = 'white';
        connectionStatus.style.padding = '10px';
        connectionStatus.style.zIndex = '1000';
    }
}

// Initialize on page load
window.addEventListener('load', () => {
    setupMobileConnection();
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

// Add these functions for stats handling
const maxDataPoints = 50;
const statsData = {
    videoBitrate: Array(maxDataPoints).fill(0),
    frameRate: Array(maxDataPoints).fill(0),
    packetsLost: Array(maxDataPoints).fill(0)
};

function initializeStatsGraph() {
    const ctx = document.getElementById('statsGraph').getContext('2d');
    statsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(maxDataPoints).fill(''),
            datasets: [{
                label: 'Bitrate (kbps)',
                data: statsData.videoBitrate,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.4
            }, {
                label: 'FPS',
                data: statsData.frameRate,
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.4
            }, {
                label: 'Packets Lost',
                data: statsData.packetsLost,
                borderColor: 'rgb(255, 205, 86)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                },
                x: {
                    display: false
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    }
                }
            }
        }
    });
}

let lastBytesSent = 0;
let lastTimestamp = 0;

async function updateStats(peerConnection) {
    if (!peerConnection) {
        console.log('No peer connection available');
        return;
    }
    
    try {
        const stats = await peerConnection.getStats();
        let videoStats = null;
        let currentBytesSent = 0;
        let currentTimestamp = 0;

        stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
                videoStats = report;
                currentBytesSent = report.bytesSent;
                currentTimestamp = report.timestamp;
            }
        });

        if (videoStats && lastBytesSent > 0) {
            const bytesPerSecond = (currentBytesSent - lastBytesSent) * 8 / (currentTimestamp - lastTimestamp) * 1000;
            const kbps = Math.round(bytesPerSecond / 1024);

            statsData.videoBitrate.push(kbps);
            statsData.videoBitrate.shift();
            
            statsData.frameRate.push(videoStats.framesPerSecond || 0);
            statsData.frameRate.shift();
            
            statsData.packetsLost.push(videoStats.packetsLost || 0);
            statsData.packetsLost.shift();

            if (statsChart) {
                statsChart.update('none');
            }
        }

        lastBytesSent = currentBytesSent;
        lastTimestamp = currentTimestamp;
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Modify your existing stopConnection function
function stopConnection() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    
    if (statsChart) {
        statsChart.destroy();
        statsChart = null;
    }
    
    isStatsVisible = false;
    document.getElementById('stats-overlay').style.display = 'none';
    document.getElementById('statsButton').classList.remove('active');
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    // ...rest of your existing stopConnection code...
}
