document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Leaflet Map
    const map = L.map('map', {
        zoomControl: false
    }).setView([17.4065, 78.4772], 13);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Clean light theme map tiles with natural colors (CartoDB Voyager)
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Real Routing and Search Logic
    const checkRouteBtnDesktop = document.getElementById('check-route-btn');
    const distVal = document.getElementById('dist-val');
    const timeVal = document.getElementById('time-val');

    // New Navigation UI Elements
    const startNavBtn = document.getElementById('start-nav-btn');
    const directionsPanel = document.getElementById('directions-panel');
    const routingInstructions = document.getElementById('routing-instructions');
    const vehicleBtns = document.querySelectorAll('.vehicle-btn');

    let routingControl = null;
    let selectedVehicle = 'driving';

    // Traffic & Navigation Extension
    let trafficLayer = L.layerGroup().addTo(map);
    let routeGeoJSONLayer = null;
    let alternativeGeoJSONLayers = [];
    let routeEndpointMarkers = [];
    let showTraffic = true;
    let lastRerouteTime = 0;
    let lastEtaUpdateTime = 0;
    let navCheckInterval = null;
    let lastPosTime = 0;

    const trafficToggleBtn = document.getElementById('traffic-toggle-btn');
    if (trafficToggleBtn) {
        trafficToggleBtn.addEventListener('click', () => {
            showTraffic = !showTraffic;
            trafficToggleBtn.innerText = showTraffic ? "🚥 Traffic: ON" : "🚥 Traffic: OFF";
            if (showTraffic) {
                trafficToggleBtn.classList.remove('off');
                trafficLayer.addTo(map);
                if (routeGeoJSONLayer) routeGeoJSONLayer.setStyle({ opacity: 0 });
            } else {
                trafficToggleBtn.classList.add('off');
                map.removeLayer(trafficLayer);
                if (routeGeoJSONLayer) routeGeoJSONLayer.setStyle({ opacity: 0.8 });
            }
        });
    }

    // Risk & Hazard Engine Extension
    const hazardData = {
        accidentZones: [
            { lat: 17.4200, lng: 78.4700, radius: 100, severity: 80, desc: "High-frequency accident zone" },
            { lat: 17.4400, lng: 78.4900, radius: 150, severity: 90, desc: "Dangerous intersection" },
            { lat: 17.4550, lng: 78.4050, radius: 120, severity: 75, desc: "Accident prone zone" }
        ],
        floodZones: [
            { lat: 17.4500, lng: 78.4000, radius: 200, severity: 70, desc: "Waterlogging area" },
            { lat: 17.4000, lng: 78.4800, radius: 100, severity: 90, desc: "Severe flood risk" }
        ],
        damageZones: [
            { lat: 17.4350, lng: 78.4450, radius: 80, severity: 60, desc: "Road construction / damage" },
            { lat: 17.4120, lng: 78.4600, radius: 90, severity: 65, desc: "Deep potholes" }
        ],
        sharpCurves: [
            { lat: 17.4300, lng: 78.4200, radius: 80, severity: 50, desc: "Sharp Curve" }
        ],
        railwayCrossings: [
            { lat: 17.4600, lng: 78.4300, radius: 100, severity: 60, desc: "Railway Crossing" }
        ]
    };

    let hazardLayer = L.layerGroup();
    let showRisk = false;
    let cachedRoutes = []; // To store OSRM alternatives for selection

    // Draw hazards onto the layer
    function redrawHazards() {
        hazardLayer.clearLayers();
        hazardData.accidentZones.forEach(h => L.circle([h.lat, h.lng], { radius: h.radius, color: 'red', fillColor: '#ef4444', fillOpacity: 0.4, weight: 1 }).bindPopup(`<b>⚠ Hazard</b><br>${h.desc}`).addTo(hazardLayer));
        hazardData.floodZones.forEach(h => L.circle([h.lat, h.lng], { radius: h.radius, color: 'blue', fillColor: '#3b82f6', fillOpacity: 0.4, weight: 1 }).bindPopup(`<b>🌊 Waterlogging</b><br>${h.desc}`).addTo(hazardLayer));
        hazardData.damageZones.forEach(h => L.circle([h.lat, h.lng], { radius: h.radius, color: 'orange', fillColor: '#f97316', fillOpacity: 0.4, weight: 1 }).bindPopup(`<b>🚧 Road Damage</b><br>${h.desc}`).addTo(hazardLayer));
        hazardData.sharpCurves.forEach(h => L.circle([h.lat, h.lng], { radius: h.radius, color: 'purple', fillColor: '#a855f7', fillOpacity: 0.4, weight: 1 }).bindPopup(`<b>↩ Sharp Curve</b><br>${h.desc}`).addTo(hazardLayer));
        hazardData.railwayCrossings.forEach(h => L.circle([h.lat, h.lng], { radius: h.radius, color: 'brown', fillColor: '#8b4513', fillOpacity: 0.4, weight: 1 }).bindPopup(`<b>🚆 Railway</b><br>${h.desc}`).addTo(hazardLayer));
    }
    redrawHazards();

    const sosBtn = document.getElementById('sos-btn');
    if (sosBtn) {
        sosBtn.addEventListener('click', () => {
            alert("🚨 EMERGENCY SOS SENT!\n\nDispatching Ambulance & Police to your live location. Live tracking link generated and shared with emergency contacts.");
        });
    }

    const reportHazardBtn = document.getElementById('report-hazard-btn');
    const hazardModal = document.getElementById('hazard-modal');
    if (reportHazardBtn && hazardModal) {
        reportHazardBtn.addEventListener('click', () => {
            hazardModal.style.display = 'flex';
        });

        document.getElementById('close-hazard-modal').addEventListener('click', () => {
            hazardModal.style.display = 'none';
        });

        document.getElementById('submit-hazard').addEventListener('click', () => {
            const centerPoint = lastUserPos || map.getCenter();
            const type = document.getElementById('hazard-type').value;
            const desc = document.getElementById('hazard-desc').value || "User Reported Hazard";

            let targetArray = hazardData.damageZones;
            if (type === 'accident') targetArray = hazardData.accidentZones;
            if (type === 'flood') targetArray = hazardData.floodZones;

            targetArray.push({
                lat: centerPoint.lat,
                lng: centerPoint.lng,
                radius: 100,
                severity: 70,
                desc: desc + " (Crowdsourced)"
            });

            redrawHazards();
            alert("Hazard Reported Successfully! It is now live on the network.");
            hazardModal.style.display = 'none';
            document.getElementById('hazard-desc').value = '';
        });
    }

    const riskToggleBtn = document.getElementById('risk-toggle-btn');
    if (riskToggleBtn) {
        riskToggleBtn.addEventListener('click', () => {
            showRisk = !showRisk;
            riskToggleBtn.innerText = showRisk ? "🛡️ Risk View: ON" : "🛡️ Risk View: OFF";
            if (showRisk) {
                riskToggleBtn.classList.remove('off');
                hazardLayer.addTo(map);
            } else {
                riskToggleBtn.classList.add('off');
                map.removeLayer(hazardLayer);
            }
        });
    }

    const safetyAlertBox = document.getElementById('safety-alert-box');
    const safetyAlertText = document.getElementById('safety-alert-text');
    let lastAlertShown = ""; // Debounce physical alerts during drive

    // Navigation State handling
    let isNavigating = false;
    let navWatchId = null;
    let navRoutePolyline = null;
    let navEndLatLng = null;
    let routeInstructions = [];
    let userMarker = null;

    const navBanner = document.getElementById('nav-banner');
    const stopNavBtn = document.getElementById('stop-nav-btn');
    const navInstruction = document.getElementById('nav-instruction');
    const navDistance = document.getElementById('nav-distance');
    const navStatus = document.getElementById('nav-status');

    const navBottomCard = document.getElementById('nav-bottom-card');
    const secondaryInstBox = document.getElementById('secondary-instruction-box');
    const navSecondaryText = document.getElementById('nav-secondary-text');
    const primaryIconBox = document.getElementById('primary-direction-icon');
    const secondaryIconBox = document.getElementById('secondary-direction-icon');
    const navEtaTime = document.getElementById('nav-eta-time');
    const navEtaDistance = document.getElementById('nav-eta-distance');
    const navEtaArrival = document.getElementById('nav-eta-arrival');
    const navZoomControls = document.getElementById('nav-zoom-controls');

    document.getElementById('nav-zoom-in')?.addEventListener('click', () => {
        map.setZoom(map.getZoom() + 1);
    });

    document.getElementById('nav-zoom-out')?.addEventListener('click', () => {
        map.setZoom(map.getZoom() - 1);
    });

    let lastUserPos = null;

    const navIcons = {
        straight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m0-16l-4 4m4-4l4 4"/></svg>`,
        left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`,
        right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>`,
        u_turn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 9a4 4 0 1 1 8 0v7M10 9L6 13M10 9l4 4"/></svg>`,
        destination: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s8-9 8-14a8 8 0 1 0-16 0c0 5 8 14 8 14z"/><circle cx="12" cy="7" r="3"/></svg>`
    };

    function getIconForStep(step) {
        if (!step || !step.text) return navIcons.straight;
        let t = step.text.toLowerCase();
        if (t.includes('arrive') || t.includes('destination')) return navIcons.destination;
        if (t.includes('u-turn')) return navIcons.u_turn;
        if (t.includes('left')) return navIcons.left;
        if (t.includes('right')) return navIcons.right;
        return navIcons.straight;
    }

    if (stopNavBtn) {
        stopNavBtn.addEventListener('click', stopNavigationMode);
    }

    // Handle vehicle selection
    vehicleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            vehicleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedVehicle = btn.getAttribute('data-vehicle') || 'driving';
            // If there's an active route on map, recalculate it
            if (routeGeoJSONLayer) {
                calculateRealRoute();
            }
        });
    });

    function startNavigationMode() {
        if (!routeGeoJSONLayer || !navRoutePolyline) return;

        isNavigating = true;
        document.body.classList.add('nav-mode');

        // Hide alternative routes during active navigation
        alternativeGeoJSONLayers.forEach(l => map.removeLayer(l));

        if (navBanner) {
            navBanner.classList.add('active');
            if (navStatus) {
                navStatus.innerText = "En Route";
                navStatus.classList.remove('rerouting');
            }
        }
        if (navBottomCard) navBottomCard.classList.add('active');
        if (navZoomControls) {
            navZoomControls.style.display = 'flex';
            // short delay for css transition
            setTimeout(() => navZoomControls.classList.add('active'), 10);
        }

        map.dragging.disable();
        // map.touchZoom.disable();
        // map.doubleClickZoom.disable();
        map.scrollWheelZoom.disable();

        // Initial camera repositioning
        if (navRoutePolyline && navRoutePolyline.length > 0) {
            let startPoint = navRoutePolyline[0];
            let targetZoom = 17;
            let mapHeight = map.getSize().y;
            let yOffset = mapHeight * 0.20; // 20% down from center
            let targetPoint = map.project(startPoint, targetZoom);
            targetPoint.y -= yOffset;
            let targetCenter = map.unproject(targetPoint, targetZoom);

            map.setView(targetCenter, targetZoom, {
                animate: true,
                duration: 1.0,
                easeLinearity: 0.25
            });
        }

        // Start 45s automatic traffic refresh checker
        if (!navCheckInterval) {
            navCheckInterval = setInterval(() => {
                if (userMarker) {
                    reRoute(userMarker.getLatLng()); // 45s recalculation
                }
            }, 45000);
        }

        // Start GPS tracking
        if (navigator.geolocation) {
            navWatchId = navigator.geolocation.watchPosition(
                updateNavigationUI,
                (error) => console.error("GPS Error:", error),
                { enableHighAccuracy: true, maximumAge: 0 }
            );
        } else {
            alert("Geolocation is not supported by your browser.");
        }
    }

    function stopNavigationMode() {
        isNavigating = false;
        document.body.classList.remove('nav-mode');

        if (navBanner) navBanner.classList.remove('active');
        if (navBottomCard) navBottomCard.classList.remove('active');
        if (navZoomControls) {
            navZoomControls.classList.remove('active');
            setTimeout(() => navZoomControls.style.display = 'none', 500);
        }
        lastUserPos = null;
        isReroutingNow = false;
        offRouteStartTime = 0;

        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
        map.scrollWheelZoom.enable();

        if (navWatchId !== null) {
            navigator.geolocation.clearWatch(navWatchId);
            navWatchId = null;
        }

        if (navCheckInterval) {
            clearInterval(navCheckInterval);
            navCheckInterval = null;
        }

        // Fit map back to route
        if (navRoutePolyline && navRoutePolyline.length > 0) {
            map.fitBounds(L.latLngBounds(navRoutePolyline), { padding: [50, 50] });
        }

        if (startNavBtn) {
            startNavBtn.innerHTML = "🚀 Start Navigation";
            startNavBtn.onclick = startNavigationMode;
        }
    }

    function getDistanceFromPolyline(latlng, polyline) {
        let minMeters = Infinity;
        for (let i = 0; i < polyline.length; i++) {
            const d = latlng.distanceTo(polyline[i]);
            if (d < minMeters) minMeters = d;
        }
        return minMeters;
    }

    function getBearing(start, end) {
        const startLat = start.lat * Math.PI / 180;
        const startLng = start.lng * Math.PI / 180;
        const endLat = end.lat * Math.PI / 180;
        const endLng = end.lng * Math.PI / 180;
        const y = Math.sin(endLng - startLng) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
        const brng = Math.atan2(y, x);
        return (brng * 180 / Math.PI + 360) % 360;
    }

    let offRouteStartTime = 0;
    let isReroutingNow = false;

    function updateNavigationUI(position) {
        if (!isNavigating || !navRoutePolyline || isReroutingNow) return;

        // Ignore inaccurate GPS updates
        if (position.coords.accuracy > 50) return;

        let userLatLng = L.latLng(position.coords.latitude, position.coords.longitude);

        let heading = 0;
        let distMoved = 0;

        if (lastUserPos) {
            distMoved = lastUserPos.distanceTo(userLatLng);
            if (distMoved < 4) {
                // Ignore small GPS drifts when standing still
                userLatLng = lastUserPos; // Snap user to previous location
            } else {
                heading = getBearing(lastUserPos, userLatLng);
                lastUserPos = userLatLng;
            }
        } else {
            lastUserPos = userLatLng;
        }

        // If slow or stopped, fallback to device hardware compass
        if (distMoved < 4 && position.coords.heading) {
            heading = position.coords.heading;
        }

        let currentPosTime = Date.now();
        let speedKmph = 0;
        if (position.coords.speed !== null && !isNaN(position.coords.speed)) {
            speedKmph = position.coords.speed * 3.6;
        } else if (lastUserPos && lastPosTime) {
            let dMeters = lastUserPos.distanceTo(userLatLng);
            let timeSecs = (currentPosTime - lastPosTime) / 1000;
            if (timeSecs > 0) speedKmph = (dMeters / timeSecs) * 3.6;
        }
        lastPosTime = currentPosTime;

        const speedEl = document.getElementById('nav-speed');
        if (speedEl) speedEl.innerText = Math.round(speedKmph) + " km/h";

        // Navigation Real-Time Hazard Alerting System
        let triggerAlert = null;
        const alertBufferMeters = 500;

        const checkHazardDistance = (dataArr, iconStr) => {
            for (let hz of dataArr) {
                let d = userLatLng.distanceTo(L.latLng(hz.lat, hz.lng));
                // Proximity trigger (approaching perimeter)
                if (d < (hz.radius + alertBufferMeters)) {
                    triggerAlert = `${iconStr} ${hz.desc}`;
                    break;
                }
            }
        };

        checkHazardDistance(hazardData.accidentZones, "⚠");
        if (!triggerAlert) checkHazardDistance(hazardData.floodZones, "🌊");
        if (!triggerAlert) checkHazardDistance(hazardData.damageZones, "🚧");
        if (!triggerAlert) checkHazardDistance(hazardData.sharpCurves, "↩");
        if (!triggerAlert) checkHazardDistance(hazardData.railwayCrossings, "🚆");

        // Driver Safety Speed Monitoring
        let speedLimit = 60; // Assume 60 km/h default city limit context
        if (speedKmph > speedLimit) {
            if (!triggerAlert) triggerAlert = `🚔 OVERSPEEDING! Reduce speed below ${speedLimit} km/h`;
            if (speedEl) speedEl.style.color = 'var(--warning-red)';
            if (speedEl) speedEl.style.fontWeight = 'bold';
        } else {
            if (speedEl) speedEl.style.color = 'var(--text-muted)';
        }

        if (triggerAlert && triggerAlert !== lastAlertShown) {
            safetyAlertText.innerText = triggerAlert;
            if (!triggerAlert.includes("OVERSPEEDING")) safetyAlertText.innerText += " ahead!";
            safetyAlertBox.classList.add('active');
            lastAlertShown = triggerAlert;
            // Auto hide
            setTimeout(() => {
                safetyAlertBox.classList.remove('active');
            }, 8000);
        } else if (!triggerAlert) {
            lastAlertShown = ""; // Reset if clear
            safetyAlertBox.classList.remove('active');
        }

        // Smart & Stable Re-Routing Check (threshold 120m)
        const distToRoute = getDistanceFromPolyline(userLatLng, navRoutePolyline);
        if (distToRoute > 120) {
            if (offRouteStartTime === 0) offRouteStartTime = currentPosTime;

            // Trigger reroute ONLY if continuously off-route for > 7 seconds
            if (currentPosTime - offRouteStartTime > 7000) {
                isReroutingNow = true;
                offRouteStartTime = 0;
                reRoute(userLatLng);
                return;
            }
        } else {
            offRouteStartTime = 0; // Reset timer if user returns towards route
        }

        let closestInst = null;
        let minDist = Infinity;
        let userPolyIdx = 0;

        // Find exactly where the user is longitudinally along the navigation route
        let minDPoly = Infinity;
        for (let i = 0; i < navRoutePolyline.length; i++) {
            let d = userLatLng.distanceTo(navRoutePolyline[i]);
            if (d < minDPoly) {
                minDPoly = d;
                userPolyIdx = i;
            }
        }

        // Find the strictly upcoming instruction along the route
        if (routeInstructions && routeInstructions.length > 0) {
            for (let i = 0; i < routeInstructions.length; i++) {
                let inst = routeInstructions[i];
                if (inst.index >= userPolyIdx) {
                    closestInst = i;
                    let instLatLng = navRoutePolyline[inst.index];
                    if (instLatLng) {
                        minDist = userLatLng.distanceTo(instLatLng);
                    }
                    break;
                }
            }
            // Fallback if at end of path
            if (closestInst === null) {
                closestInst = routeInstructions.length - 1;
                let instLatLng = navRoutePolyline[routeInstructions[closestInst].index];
                if (instLatLng) minDist = userLatLng.distanceTo(instLatLng);
            }
        }

        // Dynamic Camera Zoom Adjustment
        let targetZoom = map.getZoom(); // Respect current zoom level
        // only auto zoom-in if user hasn't explicitly scrolled way out (e.g., they are around default 17-18)
        if (minDist !== Infinity && minDist < 150 && targetZoom === 17) {
            targetZoom = 18; // Slight zoom-in effect when approaching turns
        } else if (minDist >= 150 && targetZoom === 18) {
            targetZoom = 17; // Revert to default zoom after turn if no longer in turn radius
        }

        // Calculate offset center for camera view (lower 30% of screen)
        let mapHeight = map.getSize().y;
        let yOffset = mapHeight * 0.20; // Move center up by 20% so marker appears at 70% height
        let targetPoint = map.project(userLatLng, targetZoom);
        targetPoint.y -= yOffset;
        let targetCenter = map.unproject(targetPoint, targetZoom);

        // Apply smooth easing transitions using setZoom + panTo
        if (targetZoom !== map.getZoom()) {
            map.setZoom(targetZoom, { animate: true });
        }
        map.panTo(targetCenter, {
            animate: true,
            duration: 1.0,
            easeLinearity: 0.25
        });

        // Update User Marker
        if (userMarker) {
            userMarker.setLatLng(userLatLng);
            const iconElement = userMarker.getElement();
            if (iconElement) {
                const inner = iconElement.querySelector('.nav-user-marker');
                if (inner) inner.style.transform = `rotate(${heading}deg)`;
            }
        } else {
            userMarker = L.marker(userLatLng, {
                icon: L.divIcon({
                    className: 'nav-user-container', // Custom class for smooth CSS transform transitions
                    html: `<div class="nav-user-marker" style="transform: rotate(${heading}deg)"></div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                })
            }).addTo(map);
        }

        if (closestInst !== null && routeInstructions[closestInst]) {
            const step = routeInstructions[closestInst];
            if (navInstruction) navInstruction.innerText = step.text;
            if (primaryIconBox) primaryIconBox.innerHTML = getIconForStep(step);

            let distStr = minDist > 1000 ? (minDist / 1000).toFixed(1) + ' km' : Math.round(minDist) + ' m';
            if (navDistance) navDistance.innerText = distStr;

            // Road name update
            let roadEl = document.getElementById('nav-road-name');
            let roadName = step.road || step.name || "";
            if (roadName) {
                if (roadEl) roadEl.innerText = roadName;
            } else {
                let match = step.text.match(/onto\s+(.+)$/i);
                if (match && roadEl) roadEl.innerText = match[1];
                else if (roadEl) roadEl.innerText = "En Route";
            }

            // ETA 10s smart update
            if (currentPosTime - lastEtaUpdateTime > 10000) {
                lastEtaUpdateTime = currentPosTime;
                let rawRemainingDist = 0;
                for (let i = closestInst; i < routeInstructions.length; i++) {
                    rawRemainingDist += routeInstructions[i].distance || 0;
                }
                let distKm = rawRemainingDist / 1000;
                if (distKm > 0.05) { // Only update if > 50m remaining
                    let expectedSpeed = (step.distance && step.time) ? (step.distance / step.time) * 3.6 : 30;
                    if (expectedSpeed <= 0) expectedSpeed = 30; // fallback
                    let timeHours = distKm / expectedSpeed;
                    let timeMins = Math.round(timeHours * 60);

                    if (navEtaTime) navEtaTime.innerText = formatTime(timeMins);
                    if (navEtaDistance) navEtaDistance.innerText = distKm.toFixed(1) + " km";

                    const arr = new Date();
                    arr.setMinutes(arr.getMinutes() + timeMins);
                    if (navEtaArrival) navEtaArrival.innerText = arr.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
            }

            // Secondary Instruction Box
            if (routeInstructions[closestInst + 1] && secondaryInstBox) {
                secondaryInstBox.classList.add('active');
                if (navSecondaryText) navSecondaryText.innerText = routeInstructions[closestInst + 1].text;
                if (secondaryIconBox) secondaryIconBox.innerHTML = getIconForStep(routeInstructions[closestInst + 1]);
            } else if (secondaryInstBox) {
                secondaryInstBox.classList.remove('active');
            }
        }
    }

    function reRoute(currentLatLng) {
        const now = Date.now();
        if (now - lastRerouteTime < 30000) {
            isReroutingNow = false;
            return; // Debounce max 1 in 30s
        }
        lastRerouteTime = now;

        if (navStatus && navStatus.innerText === "Re-routing...") {
            isReroutingNow = false;
            return; // Prevent multiple calls
        }

        if (navStatus) {
            navStatus.innerText = "Re-routing...";
            navStatus.classList.add('rerouting');
        }
        if (navInstruction) navInstruction.innerText = "Calculating fastest path...";
        if (navDistance) navDistance.innerText = "--";
        if (secondaryInstBox) secondaryInstBox.classList.remove('active');
        if (primaryIconBox) primaryIconBox.innerHTML = navIcons.straight;

        if (navEndLatLng) {
            const startLocInput = document.getElementById('start-loc');
            if (startLocInput) {
                startLocInput.value = `${currentLatLng.lat.toFixed(5)}, ${currentLatLng.lng.toFixed(5)}`;
            }
            calculateRealRoute();
        } else {
            isReroutingNow = false;
        }
    }

    async function getCoordinates(query) {
        try {
            // Check if query is exact lat,lng formatting (from My Location)
            const latLngMatch = query.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
            if (latLngMatch) {
                return L.latLng(parseFloat(latLngMatch[1]), parseFloat(latLngMatch[3]));
            }

            // For faster lookups, append countrycodes or use jsonv2
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&q=${encodeURIComponent(query)}&limit=1`);
            const data = await res.json();
            if (data && data.length > 0) {
                return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
            }
        } catch (error) {
            console.error("Geocoding Error: ", error);
        }
        return null;
    }

    function formatTime(minutes) {
        if (minutes < 60) {
            return `${minutes} min`;
        }
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
    }

    function updateRouteUI(distKm, timeMins) {
        const routePanel = document.getElementById('route-panel');
        if (routePanel) routePanel.style.display = 'block';

        if (distVal) distVal.innerText = `${distKm} km`;
        if (timeVal) timeVal.innerText = formatTime(timeMins);
    }

    function drawTrafficSegments(route) {
        trafficLayer.clearLayers();
        let coords = route.coordinates;
        let instructions = route.instructions;

        if (routeGeoJSONLayer) {
            if (showTraffic) {
                routeGeoJSONLayer.setStyle({ opacity: 0 });
            } else {
                routeGeoJSONLayer.setStyle({ opacity: 0.8 });
            }
        }

        const hour = new Date().getHours();
        let isPeakHour = (hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 21);
        let timeModifier = isPeakHour ? 0.7 : 1.0;

        // OSRM provides instructions pointing to segments in coordinates
        for (let i = 0; i < instructions.length - 1; i++) {
            let startIdx = instructions[i].index;
            let endIdx = instructions[i + 1].index;
            if (startIdx >= endIdx) continue;

            let distMeters = instructions[i].distance;
            let timeSecs = instructions[i].time;

            let speedKmph = timeSecs > 0 ? (distMeters / timeSecs) * 3.6 : 30;
            speedKmph *= timeModifier; // Simulated time of day modifier

            let color = '#10B981'; // Green (Fast)
            if (speedKmph < 25) color = '#EF4444'; // Red (Slow)
            else if (speedKmph < 45) color = '#F97316'; // Orange (Moderate)

            let segmentCoords = coords.slice(startIdx, endIdx + 1);
            let poly = L.polyline(segmentCoords, {
                color: color,
                weight: 7,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round',
                className: 'route-path-animated'
            });
            poly.addTo(trafficLayer);

            // Add simple direction arrow marker periodically
            if (segmentCoords.length > 2 && distMeters > 300) {
                let midPoint = segmentCoords[Math.floor(segmentCoords.length / 2)];
                let nextPoint = segmentCoords[Math.floor(segmentCoords.length / 2) + 1];
                let angle = getBearing(midPoint, nextPoint);

                L.marker(midPoint, {
                    icon: L.divIcon({
                        className: 'route-arrow',
                        html: `<div style="transform: rotate(${angle}deg); font-size: 14px; outline: none; border: none; font-weight: bold; color: white; text-shadow: 0 0 5px rgba(0,0,0,0.8);">➤</div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    }),
                    interactive: false
                }).addTo(trafficLayer);
            }
        }
    }

    async function snapToNearestRoad(latlng) {
        try {
            const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${latlng.lng},${latlng.lat}`);
            const data = await res.json();
            if (data.code === 'Ok' && data.waypoints && data.waypoints.length > 0) {
                return L.latLng(data.waypoints[0].location[1], data.waypoints[0].location[0]);
            }
        } catch (e) { console.error(e); }
        return latlng;
    }

    function buildManeuverText(maneuver) {
        if (!maneuver) return "Head straight";
        if (maneuver.type === "depart") return "Head " + (maneuver.modifier || "straight");
        if (maneuver.type === "arrive") return "You have arrived at your destination";
        if (maneuver.type === "turn") return "Turn " + (maneuver.modifier || "ahead");
        if (maneuver.type === "roundabout") return "Enter roundabout and take exit " + (maneuver.exit || "");
        return maneuver.type + " " + (maneuver.modifier || "");
    }

    function predictRiskScore(coordinates) {
        let baseRisk = 15; // 15% inherent risk 
        const hour = new Date().getHours();
        if (hour > 20 || hour < 6) baseRisk += 10; // Night driving risk penalty (10%)

        let localHazards = [];

        // Simulate Weather Integration (Weather API mock)
        let simulatedWeatherIndex = Math.floor(Math.random() * 10);
        baseRisk += simulatedWeatherIndex; // Weather Penalty (10%)

        // Convert route coordinates to Leaflet LatLng early for speed
        const pathLine = coordinates.map(c => L.latLng(c[1], c[0]));

        // Helper to check intersect
        const checkHazardSet = (dataSet, riskMultiplier) => {
            dataSet.forEach(hazard => {
                let hazardLatLng = L.latLng(hazard.lat, hazard.lng);
                // Simple sweep: if any point on path is within hazard radius + 50m buffer
                let intersect = pathLine.some(pt => pt.distanceTo(hazardLatLng) <= hazard.radius + 50);
                if (intersect) {
                    baseRisk += (hazard.severity * riskMultiplier);
                    localHazards.push(hazard);
                }
            });
        };

        checkHazardSet(hazardData.accidentZones, 0.25); // Accident Zones (25%)
        checkHazardSet(hazardData.floodZones, 0.10);    // Flood Zones (10%)
        checkHazardSet(hazardData.damageZones, 0.10);   // Road Damage (10%)
        checkHazardSet(hazardData.sharpCurves, 0.05);   // Curves (5%)
        checkHazardSet(hazardData.railwayCrossings, 0.05); // Railway (5%)

        baseRisk = Math.min(Math.round(baseRisk), 100);
        return { score: baseRisk, hazards: localHazards, weatherValue: simulatedWeatherIndex };
    }

    async function calculateRealRoute() {
        const startInput = document.getElementById('start-loc').value;
        const endInput = document.getElementById('end-loc').value;

        if (!startInput || !endInput) {
            alert("Please enter both start and destination locations.");
            return;
        }

        const btn = checkRouteBtnDesktop;
        if (btn) {
            btn.innerHTML = "Finding Route...";
            btn.disabled = true;
            btn.style.opacity = "0.7";
        }

        let startLatLng = await getCoordinates(startInput);
        let endLatLng = await getCoordinates(endInput);

        if (!startLatLng || !endLatLng) {
            alert(`Could not pinpoint exact location for ${!startLatLng ? '"' + startInput + '"' : '"' + endInput + '"'}. Please try adding a city name (e.g. "Gachibowli, Hyderabad").`);
            if (btn) {
                btn.innerHTML = "Get Directions";
                btn.disabled = false;
                btn.style.opacity = "1";
            }
            return;
        }

        startLatLng = await snapToNearestRoad(startLatLng);
        endLatLng = await snapToNearestRoad(endLatLng);

        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }

        if (routeGeoJSONLayer) {
            map.removeLayer(routeGeoJSONLayer);
            routeGeoJSONLayer = null;
        }

        alternativeGeoJSONLayers.forEach(l => map.removeLayer(l));
        alternativeGeoJSONLayers = [];

        routeEndpointMarkers.forEach(m => map.removeLayer(m));
        routeEndpointMarkers = [];

        try {
            const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${startLatLng.lng},${startLatLng.lat};${endLatLng.lng},${endLatLng.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`);
            const routeData = await response.json();

            if (routeData.code !== 'Ok' || !routeData.routes || routeData.routes.length === 0) {
                alert("Route not available. Please choose a nearby road.");
                if (btn) {
                    btn.innerHTML = "Get Directions";
                    btn.disabled = false;
                    btn.style.opacity = "1";
                }
                return;
            }

            cachedRoutes = routeData.routes.map(r => {
                const riskData = predictRiskScore(r.geometry.coordinates);
                return {
                    route: r,
                    risk: riskData.score,
                    hazards: riskData.hazards
                };
            });

            // Classify Routes: Fastest (min duration), Safest (min risk), Balanced
            let sortedByTime = [...cachedRoutes].sort((a, b) => a.route.duration - b.route.duration);
            let sortedByRisk = [...cachedRoutes].sort((a, b) => a.risk - b.risk);

            let fastest = sortedByTime[0];
            let safest = sortedByRisk[0];
            let balanced = cachedRoutes.find(r => r !== fastest && r !== safest) || sortedByTime[1] || fastest;

            // Render Route UI
            const container = document.getElementById('route-choices-container');
            container.innerHTML = '';

            function createChoiceCard(title, routeObj, isSelected) {
                const distKm = (routeObj.route.distance / 1000).toFixed(1);
                const timeMins = Math.round(routeObj.route.duration / 60);
                let badgeClass = routeObj.risk < 35 ? 'low' : (routeObj.risk < 65 ? 'medium' : 'high');
                let badgeText = routeObj.risk < 35 ? '🛡️ Low' : (routeObj.risk < 65 ? '⚠ Medium' : '🚨 High');

                const card = document.createElement('div');
                card.className = `route-choice-card ${isSelected ? 'selected' : ''}`;
                card.innerHTML = `
                    <div class="route-choice-header">
                        <span class="title">${title}</span>
                        <span class="risk-badge ${badgeClass}">${badgeText} (${routeObj.risk}%)</span>
                    </div>
                    <div class="route-choice-stats">
                        <span>🕒 ${timeMins} min</span>
                        <span>🛣️ ${distKm} km</span>
                    </div>
                `;
                card.onclick = () => selectRouteConfiguration(routeObj);
                container.appendChild(card);
            }

            // Create cards (Deduplicate if OSRM gives indentical paths)
            createChoiceCard("Fastest Route", fastest, true);
            if (safest !== fastest) createChoiceCard("Safest Route", safest, false);
            if (balanced !== fastest && balanced !== safest) createChoiceCard("Balanced Route", balanced, false);

            if (startNavBtn && !isNavigating) {
                startNavBtn.style.display = 'block';
                startNavBtn.innerHTML = "🚀 Start Navigation";
                startNavBtn.onclick = startNavigationMode;
            }

            if (directionsPanel) directionsPanel.style.display = 'none';

            selectRouteConfiguration(fastest); // Default plot

            isReroutingNow = false; // Release the routing lock
            if (isNavigating && navStatus) {
                navStatus.innerText = "En Route";
                navStatus.classList.remove('rerouting');
            }

        } catch (error) {
            console.error("Routing Error:", error);
            alert("Could not fetch route from service.");
            if (btn) {
                btn.innerHTML = "Get Directions";
                btn.disabled = false;
                btn.style.opacity = "1";
            }
            isReroutingNow = false;
        }
    }

    function selectRouteConfiguration(cfg) {
        // Highlight active card
        document.querySelectorAll('.route-choice-card').forEach(n => {
            if (n.innerHTML.includes(cfg.risk + "%")) n.classList.add('selected');
            else n.classList.remove('selected');
        });

        // Clear existing map paths
        if (routeGeoJSONLayer) { map.removeLayer(routeGeoJSONLayer); routeGeoJSONLayer = null; }
        alternativeGeoJSONLayers.forEach(l => map.removeLayer(l));
        alternativeGeoJSONLayers = [];
        routeEndpointMarkers.forEach(m => map.removeLayer(m));
        routeEndpointMarkers = [];

        // Draw grey alternatives
        cachedRoutes.forEach(r => {
            if (r !== cfg) {
                const altGeoJSON = L.geoJSON(r.route.geometry, {
                    style: { color: '#9CA3AF', weight: 6, opacity: 0.7, lineCap: 'round', lineJoin: 'round' } // Light Gray
                }).addTo(map);
                alternativeGeoJSONLayers.push(altGeoJSON);
            }
        });

        // Draw primary
        routeGeoJSONLayer = L.geoJSON(cfg.route.geometry, {
            style: { color: '#1E3A8A', weight: 8, opacity: showTraffic ? 0 : 0.9, lineCap: 'round', lineJoin: 'round', className: 'primary-route-path' }
        }).addTo(map);

        map.fitBounds(routeGeoJSONLayer.getBounds(), { padding: [50, 50], animate: true, duration: 0.8 });

        const startPt = cfg.route.geometry.coordinates[0];
        const endPt = cfg.route.geometry.coordinates[cfg.route.geometry.coordinates.length - 1];

        routeEndpointMarkers.push(L.marker([startPt[1], startPt[0]], {
            draggable: !isNavigating,
            icon: L.divIcon({ className: 'route-endpoints', html: `<div style="background-color: #10B981; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white;">↔</div>`, iconSize: [22, 22], iconAnchor: [11, 11] })
        }).addTo(map));

        routeEndpointMarkers.push(L.marker([endPt[1], endPt[0]], {
            draggable: !isNavigating,
            icon: L.divIcon({ className: 'route-endpoints', html: `<div style="background-color: #EF4444; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white;">↔</div>`, iconSize: [22, 22], iconAnchor: [11, 11] })
        }).addTo(map));

        navRoutePolyline = cfg.route.geometry.coordinates.map(c => L.latLng(c[1], c[0]));
        navEndLatLng = L.latLng(endPt[1], endPt[0]);

        const osrmSteps = cfg.route.legs[0].steps;
        routeInstructions = osrmSteps.map(step => {
            let locL = L.latLng(step.maneuver.location[1], step.maneuver.location[0]);
            let closestIdx = 0; let minD = Infinity;
            for (let i = 0; i < navRoutePolyline.length; i++) {
                let d = navRoutePolyline[i].distanceTo(locL);
                if (d < minD) { minD = d; closestIdx = i; }
            }
            return {
                index: closestIdx,
                text: buildManeuverText(step.maneuver),
                distance: step.distance,
                time: step.duration
            };
        });

        drawTrafficSegments({ coordinates: navRoutePolyline, instructions: routeInstructions });

        const distKm = (cfg.route.distance / 1000).toFixed(1);
        const timeMins = Math.round(cfg.route.duration / 60);

        updateRouteUI(distKm, timeMins);

        if (navEtaTime) navEtaTime.innerText = formatTime(timeMins);
        if (navEtaDistance) navEtaDistance.innerText = distKm + " km";

        const now = new Date();
        now.setMinutes(now.getMinutes() + timeMins);
        if (navEtaArrival) navEtaArrival.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (checkRouteBtnDesktop) {
            checkRouteBtnDesktop.innerHTML = "Get Directions";
            checkRouteBtnDesktop.disabled = false;
            checkRouteBtnDesktop.style.opacity = "1";
        }
    }

    if (checkRouteBtnDesktop) checkRouteBtnDesktop.addEventListener('click', calculateRealRoute);

    // Single Location Search (Mobile or General)
    const mobileSearchInput = document.querySelector('.mobile-search-bar .search-input');
    const mobileSearchBtn = document.querySelector('.mobile-search-bar .icon-btn');
    let searchMarker = null;

    async function searchSingleLocation(query) {
        if (!query) return;
        const coords = await getCoordinates(query);
        if (coords) {
            map.setView(coords, 14);
            if (searchMarker) map.removeLayer(searchMarker);
            searchMarker = L.marker(coords, {
                icon: L.divIcon({
                    className: 'search-marker',
                    html: `<div style="background-color: #3B82F6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            }).addTo(map).bindPopup(`<b>Location found</b><br>${query}`).openPopup();
        } else {
            alert("Location not found.");
        }
    }

    if (mobileSearchBtn && mobileSearchInput) {
        mobileSearchBtn.addEventListener('click', () => searchSingleLocation(mobileSearchInput.value));
        mobileSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchSingleLocation(mobileSearchInput.value);
        });
    }

    // Mobile bottom panel slide-up interaction
    const sidePanel = document.getElementById('side-panel');
    let panelState = 'open';

    if (window.innerWidth <= 768 && sidePanel) {
        const handle = document.getElementById('mobile-handle');
        if (handle) {
            handle.addEventListener('click', () => {
                if (panelState === 'open') {
                    sidePanel.style.transform = `translateY(calc(100% - 40px))`;
                    panelState = 'collapsed';
                } else {
                    sidePanel.style.transform = `translateY(0)`;
                    panelState = 'open';
                }
            });
        }
    }
    // Resize map when window resets
    window.addEventListener('resize', () => {
        map.invalidateSize();
    });

    // Geolocation / Locate Me functionality
    const locateBtn = document.getElementById('locate-btn');

    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                locateBtn.innerHTML = "⏳ Locating...";
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        const userLatLng = L.latLng(lat, lng);

                        map.setView(userLatLng, 15);

                        if (userMarker) {
                            map.removeLayer(userMarker);
                        }

                        userMarker = L.marker(userLatLng, {
                            icon: L.divIcon({
                                className: 'user-marker',
                                html: `<div style="background-color: #10B981; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px rgba(16,185,129,0.3);"></div>`,
                                iconSize: [24, 24],
                                iconAnchor: [12, 12]
                            })
                        }).addTo(map).bindPopup(`<b>You are here</b>`).openPopup();

                        // Automatically populate the Start location input
                        const startLocInput = document.getElementById('start-loc');
                        if (startLocInput) {
                            startLocInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                        }

                        locateBtn.innerHTML = "📍 My Location";
                    },
                    (error) => {
                        console.error(error);
                        alert("Could not get your location. Please ensure location permissions are granted.");
                        locateBtn.innerHTML = "📍 My Location";
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            } else {
                alert("Geolocation is not supported by your browser.");
            }
        });
    }
});
