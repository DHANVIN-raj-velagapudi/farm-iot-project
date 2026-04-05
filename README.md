Farm IoT Backend (v1.0.0)
Author: VELAGAPUDI DHANVIN RAJ

This is a  Node.js backend designed for Farm IoT systems, specifically optimized for use with ESP32 microcontrollers. It provides a robust, Firebase-free environment for monitoring soil moisture, managing irrigation pumps, and controlling lighting systems.

🚀 Key FeaturesReal-time Device Monitoring: Tracks "Online/Offline" status based on heartbeats.Manual & Automated Control: Support for manual pump/light overrides with safety timers.Smart Scheduling: Time-based automation for irrigation and lighting.Local Persistence: Uses high-performance JSON and NDJSON storage for device states and logs, ensuring data is saved even after a restart.Security: Integrated x-device-token header authentication for secure hardware-to-server communication.

🛠️ Quick StartInstall Dependencies:Bashnpm install express cors
Environment Setup:Set your secure token as an environment variable (optional):Bashexport DEVICE_TOKEN="your_secure_token"
Run the Server:Bashnode server.js

📡 API Endpoints
EndpointMethodDescription

/ping     POSTUpdates device heartbeat and status.
/control  POSTManually toggles the water pump with optional timers.
/lights   POSTControls specific light IDs (L1-L10).
/data     POSTReceives moisture levels and generates low-water warnings.
/state    GETReturns the current status of all connected devices.

📝 Development StatusCurrent Version: v1.0.0
This version marks the initial stable release of the backend architecture. It has been streamlined for performance by removing external database dependencies in favor of local, high-speed file storage.Future Roadmap:Implementation of advanced AI-driven predictive analytics.Web-based dashboard for visual data representation.Multi-user authentication and mobile app integration.

⚠️ Disclaimer & LiabilityAs-Is Basis: 
This software is provided "as is" and "with all faults." The developers make no representations or warranties of any kind concerning the safety, suitability, lack of viruses, inaccuracies, or other harmful components of this software.

No Liability:
In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software. Use at your own risk.
