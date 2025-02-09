const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        transports: ['websocket', 'polling'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});
const fs = require('fs');
const path = require('path');
const os = require('os');
const port = 8080;  // Changed port to 8080

// Improved IP detection for macOS
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    // Collect all IPv4 addresses
    Object.keys(interfaces).forEach((name) => {
        interfaces[name].forEach((net) => {
            // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`Found IP on ${name}:`, net.address);
                addresses.push(net.address);
            }
        });
    });

    // Return first non-internal IPv4 address or localhost as fallback
    return addresses.length > 0 ? addresses[0] : '127.0.0.1';
}

const localIP = getLocalIP();
console.log('Using IP:', localIP);

app.use(express.static(__dirname));

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// Make IP address available to client
app.get('/config', (req, res) => {
    res.json({ serverIP: localIP });
});

// Serve index.html for all routes to handle client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = new Map(); // rooms store format: roomId -> Map<socketId, {peerId, streams: Set<streamId>}>

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', (roomId) => {
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);
        room.set(socket.id, { peerId: socket.id, streams: new Set() });
        socket.join(roomId);

        // Notify all existing users in the room about the new user
        socket.to(roomId).emit('user-connected', socket.id);

        // Send existing users to the new participant
        const existingUsers = Array.from(room.keys()).filter(id => id !== socket.id);
        socket.emit('existing-users', existingUsers);
        
        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    socket.on('stream-started', (roomId, streamId) => {
        const room = rooms.get(roomId);
        if (room && room.has(socket.id)) {
            const user = room.get(socket.id);
            user.streams.add(streamId);
            socket.to(roomId).emit('peer-stream-started', socket.id, streamId);
        }
    });

    socket.on('stream-stopped', (roomId, streamId) => {
        const room = rooms.get(roomId);
        if (room && room.has(socket.id)) {
            const user = room.get(socket.id);
            user.streams.delete(streamId);
            socket.to(roomId).emit('peer-stream-stopped', socket.id, streamId);
        }
    });

    socket.on('offer', (offer, roomId) => {
        console.log(`Offer received from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('offer', offer);
    });

    socket.on('answer', (answer, roomId) => {
        console.log(`Answer received from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('answer', answer);
    });

    socket.on('ice-candidate', (candidate, roomId) => {
        console.log(`ICE candidate from ${socket.id} for room ${roomId}`);
        socket.to(roomId).emit('ice-candidate', candidate);
    });

    // list of all users in the room
    socket.on('list-users', (roomId) => {
        const room = rooms.get(roomId);
        const users = [];
        if (room) {
            room.forEach((userData, userId) => {
                users.push({
                    id: userId,
                    streams: Array.from(userData.streams)
                });
            });
        }
        socket.emit('list-users', users);
    });

    socket.on('console-command', (command) => {
        switch(command) {
            case 'people':
                let response = '\n=== Current Rooms and Users ===\n';
                if (rooms.size === 0) {
                    response += 'No active rooms';
                } else {
                    rooms.forEach((users, roomId) => {
                        response += `\nRoom ${roomId}:\n`;
                        response += `Users: ${Array.from(users)}\n`;
                        response += `Total users in room: ${users.size}\n`;
                    });
                    response += `\nTotal rooms: ${rooms.size}\n`;
                    response += `Total users: ${Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0)}`;
                }
                socket.emit('console-response', response);
                break;

            case 'clear':
                const totalRooms = rooms.size;
                const totalUsers = Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0);
                
                rooms.forEach((users, roomId) => {
                    io.to(roomId).emit('force-disconnect', 'Server clearing all rooms');
                });
                
                rooms.clear();
                socket.emit('console-response', `Cleared ${totalRooms} rooms and disconnected ${totalUsers} users`);
                break;
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        rooms.forEach((users, roomId) => {
            if (users.has(socket.id)) {
                const user = users.get(socket.id);
                // Notify others about all streams that were active
                user.streams.forEach(streamId => {
                    socket.to(roomId).emit('peer-stream-stopped', socket.id, streamId);
                });
                users.delete(socket.id);
                if (users.size === 0) {
                    rooms.delete(roomId);
                }
                socket.to(roomId).emit('user-disconnected', socket.id);
            }
        });
        console.log('User disconnected:', socket.id);
    });

    socket.on('force-disconnect', () => {
        socket.disconnect(true);
    });
});

// Console commands for server management
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

readline.on('line', (input) => {
    switch(input.toLowerCase()) {
        case 'people':
            console.log('\n=== Current Rooms and Users ===');
            if (rooms.size === 0) {
                console.log('No active rooms');
            } else {
                rooms.forEach((users, roomId) => {
                    console.log(`\nRoom ${roomId}:`);
                    console.log('Users:', Array.from(users));
                    console.log('Total users in room:', users.size);
                });
                console.log('\nTotal rooms:', rooms.size);
                console.log('Total users:', Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0));
            }
            break;

        case 'clear':
            const totalRooms = rooms.size;
            const totalUsers = Array.from(rooms.values()).reduce((acc, room) => acc + room.size, 0);
            
            // Notify all users in all rooms that they're being disconnected
            rooms.forEach((users, roomId) => {
                io.to(roomId).emit('force-disconnect', 'Server clearing all rooms');
            });
            
            // Clear all rooms
            rooms.clear();
            console.log(`Cleared ${totalRooms} rooms and disconnected ${totalUsers} users`);
            break;

        case 'help':
            console.log('\nAvailable commands:');
            console.log('people - Show all rooms and users');
            console.log('clear  - Disconnect all users and clear all rooms');
            console.log('help   - Show this help message');
            break;

        default:
            console.log('Unknown command. Type "help" for available commands');
    }
});

// Update the server listening configuration
http.listen(port, '0.0.0.0', () => {
    const networks = os.networkInterfaces();
    console.log('\n=== Network Interfaces ===');
    
    // Format and display each network interface
    let validIPs = [];
    
    Object.keys(networks).forEach(name => {
        networks[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                validIPs.push({
                    interface: name,
                    ip: net.address
                });
                console.log(`\n${name}:`);
                console.log(`  IP: ${net.address}`);
                console.log(`  Type: ${net.internal ? 'Internal' : 'External'}`);
            }
        });
    });

    // Display connection information
    console.log('\n=== Connection URLs ===');
    if (validIPs.length > 0) {
        console.log('\n📱 For mobile devices, use one of these URLs:');
        validIPs.forEach(({interface, ip}) => {
            console.log(`\n  http://${ip}:${port}`);
            console.log(`  (via ${interface})`);
        });
    } else {
        console.log('\n⚠️  No external network interfaces found!');
    }

    // Always show localhost
    console.log('\n💻 Local development:');
    console.log(`  http://localhost:${port}`);
    console.log(`  http://127.0.0.1:${port}`);
    
    // Print the recommended URL
    if (validIPs.length > 0) {
        console.log('\n✅ Recommended URL for mobile devices:');
        console.log(`  http://${validIPs[0].ip}:${port}`);
    }
    console.log('\n=== Server is running ===\n');
});
