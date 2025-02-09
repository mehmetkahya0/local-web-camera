# Local Web Camera Project Architecture

```mermaid
graph TB
    Browser[Browser Interface]
    Server[Web Server]
    Camera[Web Camera]
    Process[Video Processing]
    Socket[WebSocket Server]

    Browser --- Server
    Server --- |Left Branch|Camera
    Server --- |Middle Branch|Process
    Server --- |Right Branch|Socket
    
    classDef default fill:#f9f,stroke:#333,stroke-width:2px;
    classDef browser fill:#bbf,stroke:#333,stroke-width:2px;
    classDef hardware fill:#bfb,stroke:#333,stroke-width:2px;
    
    class Browser browser;
    class Camera hardware;
```

This diagram shows the tree structure of:
- Root: Browser Interface
- Main node: Web Server
- Three branches:
  - Web Camera (Hardware)
  - Video Processing
  - WebSocket Server
