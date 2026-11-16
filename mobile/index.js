// The background task must be defined when the JS bundle loads, also when the OS starts it headless (no UI, so no route is rendered).
import "./src/backgroundTask";
import "expo-router/entry";
