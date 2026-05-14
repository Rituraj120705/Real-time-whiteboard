# CollabBoard - Real-Time Collaborative Whiteboard

![CollabBoard](https://img.shields.io/badge/Status-Completed-success?style=for-the-badge) ![MERN Stack](https://img.shields.io/badge/Tech-MERN_Stack-blue?style=for-the-badge)

CollabBoard is an advanced, high-performance real-time collaborative whiteboard built using the **MERN Stack**, **Socket.io**, **Redis**, and **Fabric.js**. It features a beautiful glassmorphism UI, infinite panning, image drag-and-drop, sticky notes, and a dashboard for persistent storage.

It is heavily optimized for **Group Study Sessions**, allowing multiple students to connect simultaneously, solve math problems, brainstorm ideas, and share study materials in real time.

---

## 🎯 Use Case: Group Study & Collaboration

This application is built to replace physical whiteboards for remote students and teams. Here is how a group study session works:

### Step 1: Creating a Study Room (The Host)
1. The host opens the application and lands on the **Dashboard**, which displays their previously saved study boards.
2. They click the **+ New Board** button.
3. In the join modal, the host types their **Name** and leaves the "Room Code" blank.
4. Clicking **Create New Room** automatically generates a secure, randomized 6-character room code (e.g., `X7B9K2`) and drops the host into the infinite canvas.

### Step 2: Adding Members to the Room
1. The host shares the 6-character **Room Code** shown at the top of the screen with their study group (via WhatsApp, Discord, etc.).
2. The other students open the app, click **+ New Board**, type their **Name**, and type the shared **Room Code**.
3. Upon clicking **Join Room**, they are instantly connected to the exact same whiteboard session.

### Step 3: Real-Time Writing & Studying
* **Live Cursors**: Every student's mouse cursor is broadcasted in real-time with their name and a unique color attached to it, so everyone knows who is pointing at what.
* **Problem Solving**: Students can select the **Pen Tool** to freehand draw math equations, diagrams, or chemical structures.
* **Note Taking**: Use the **Sticky Note Tool** to drop colored post-it notes around the board for flashcards, reminders, or definitions.
* **Sharing Materials**: Anyone can **Drag and Drop an Image** (like a textbook snippet or lecture slide) directly onto the canvas. The image instantly syncs to everyone's screen, allowing the group to draw arrows and highlight text right on top of it.
* **Infinite Canvas**: If the group runs out of space, they simply scroll down with the mouse wheel to reveal an endless amount of fresh whiteboard space.
* **Saving Progress**: When the study session is over, clicking **Home** automatically generates a visual thumbnail of the board and saves the session to the database so it can be resumed later from the Dashboard.

---

## 🚀 Features

* **Real-time WebSockets**: Ultra-low latency synchronization using `Socket.io`.
* **Redis Pub/Sub**: Scalable backend architecture ready for multi-server deployment.
* **Advanced Canvas Engine**: Built on `Fabric.js v6` for highly optimized vector graphics rendering.
* **Infinite Pan & Zoom**: Scroll to pan across an endless document, or hold `Ctrl` to zoom.
* **Image Drag & Drop**: Instantly import images via Base64 serialization.
* **Dashboard Persistence**: Saved boards are stored in the backend database with auto-generated canvas thumbnails.
* **Modern UI/UX**: Premium dark-mode aesthetics utilizing glassmorphism, fluid animations, and `lucide-react` iconography.

## 💻 Tech Stack

* **Frontend**: React.js, Vite, Fabric.js (v6), CSS3 (Glassmorphism)
* **Backend**: Node.js, Express.js
* **Real-Time Engine**: Socket.io, Redis Adapter
* **Storage**: In-Memory Database (Prepared for MongoDB migration)

## 🛠️ How to Run Locally

1. **Start the Backend**:
   ```bash
   cd backend
   npm install
   node index.js
   ```

2. **Start the Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Open `http://localhost:5173` in your browser.
