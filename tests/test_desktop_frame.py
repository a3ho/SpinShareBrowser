"""Native frame input stays on one app-owned HWND, outside WebView drag regions."""
import ctypes
import http.client
import json
import sys
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import desktop


class NativeCall:
    def __init__(self, callback=lambda *args: 1):
        self.callback = callback
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        return self.callback(*args)


class DesktopFrameTests(unittest.TestCase):
    def setUp(self):
        self.instance = object.__new__(desktop.Desktop)
        self.instance.frame_handles = set()
        self.instance.frame_overlay = None
        self.instance._update_frame_region = lambda: None
        self.native = SimpleNamespace(**{name: NativeCall() for name in (
            "SetWindowSubclass", "RemoveWindowSubclass", "DefSubclassProc")})
        self.user = SimpleNamespace(**{name: NativeCall() for name in (
            "GetWindowRect", "GetDpiForWindow", "GetSystemMetricsForDpi", "IsZoomed",
            "GetCursorPos", "LoadCursorW", "SetCursor", "GetWindowThreadProcessId",
            "SendMessageW", "CreateWindowExW", "DestroyWindow", "ValidateRect", "SetWindowRgn")})
        self.user.CreateWindowExW.callback = lambda *args: 200
        self.user.GetDpiForWindow.callback = lambda *args: 168
        self.user.GetSystemMetricsForDpi.callback = lambda *args: 5
        self.user.IsZoomed.callback = lambda *args: 0
        def rectangle(handle, pointer):
            pointer._obj.left, pointer._obj.top = 100, 100
            pointer._obj.right, pointer._obj.bottom = 1100, 800
            return 1
        self.user.GetWindowRect.callback = rectangle
        with (patch.object(desktop.ctypes, "WinDLL", return_value=self.native),
              patch.object(desktop.ctypes, "WINFUNCTYPE", return_value=lambda callback: callback)):
            self.instance._install_frame(100, self.user)

    def call(self, message, wparam=0, x=500, y=130, hwnd=200):
        return self.instance.frame_callback(hwnd, message, wparam, (y << 16) | (x & 0xffff), 1, 0)

    def test_one_native_child_owns_caption_and_all_resize_edges_at_scaled_dpi(self):
        self.assertEqual(self.instance.frame_handles, {100, 200})
        self.assertEqual(len(self.native.SetWindowSubclass.calls), 2)
        self.assertEqual(self.call(0x84), 2)
        for x, y, hit in ((101,101,13),(500,101,12),(1099,101,14),
                          (101,400,10),(1099,400,11),(101,799,16),
                          (500,799,15),(1099,799,17)):
            self.assertEqual(self.call(0x84,x=x,y=y), hit)
        self.user.IsZoomed.callback = lambda *args: 1
        self.assertEqual(self.call(0x84,x=101,y=101), 2)

    def test_move_double_click_system_menu_and_touch_use_host_system_messages(self):
        for message in (0xA1,0xA3,0xA4,0xA5,0x241,0x242,0x243):
            self.call(message,wparam=2)
            self.assertEqual(self.user.SendMessageW.calls[-1][:3], (100,message,2))
        self.call(0xF)
        self.assertEqual(self.user.ValidateRect.calls[-1], (200,None))
        self.assertEqual(self.call(0x14), 1)

    def test_native_child_destruction_releases_tracking_without_touching_webview_children(self):
        self.call(0x82)
        self.assertEqual(self.instance.frame_handles,{100})
        self.assertIsNone(self.instance.frame_overlay)
        self.assertEqual(self.native.RemoveWindowSubclass.calls[-1][0],200)

    def test_layout_updates_only_post_to_ui_and_reject_invalid_numbers_or_extra_rectangles(self):
        layout={"viewport":[1320,860],"pixelRatio":1,"headerHeight":64,"excluded":[[24,12,220,34],[300,4,700,56]]}
        posted=[]
        self.instance.post=lambda callback: posted.append(callback) is None
        self.assertTrue(self.instance.update_frame_layout(layout))
        self.assertEqual(len(posted),1)
        posted.pop()()
        self.assertEqual(self.instance.frame_layout,layout)
        for count in (4,5):
            expanded=dict(layout,excluded=[[index*100,12,48,34] for index in range(count)])
            self.assertTrue(self.instance.update_frame_layout(expanded))
            self.assertEqual(len(posted),1)
            posted.pop()()
            self.assertEqual(self.instance.frame_layout,expanded)
        for invalid in (dict(layout,viewport=[True,860]),dict(layout,viewport=[0,860]),
                        dict(layout,headerHeight=float('nan')),dict(layout,headerHeight=float('inf')),
                        dict(layout,excluded=[[0,0,1,1]]*6),dict(layout,excluded=[[-1,0,1,1]]),
                        dict(layout,extra=1),dict(layout,excluded=[[1,2,3]])):
            self.assertFalse(self.instance.update_frame_layout(invalid))
        self.assertEqual(posted,[])

    def test_native_region_excludes_controls_and_suspends_stale_caption_after_resize(self):
        instance=self.instance
        instance.frame_geometry=None
        instance.frame_layout={"viewport":[1000,700],"pixelRatio":1,"headerHeight":64,
                               "excluded":[[24,12,220,34],[830,0,170,64],
                                           [300,8,48,48],[396,38,276,18],[700,24,44,18]]}
        instance.form=SimpleNamespace(IsDisposed=False,ClientSize=SimpleNamespace(Width=1000,Height=700),
                                      WindowState=0,Handle=SimpleNamespace(ToInt64=lambda:100))
        instance.Forms=SimpleNamespace(FormWindowState=SimpleNamespace(Maximized=1))
        instance.frame_user=self.user
        self.user.SetWindowPos=NativeCall()
        regions=[]
        self.user.SetWindowRgn.callback=lambda hwnd,region,repaint: regions.append(region) is None
        gdi=ctypes.WinDLL("gdi32")
        gdi.PtInRegion.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int]
        gdi.PtInRegion.restype=ctypes.c_int
        gdi.DeleteObject.argtypes=[ctypes.c_void_p]
        try:
            desktop.Desktop._update_frame_region(instance)
            for x,y in ((500,25),(370,45),(687,45),(780,25)):
                self.assertTrue(gdi.PtInRegion(regions[-1],x,y),"Player text/time and surrounding blank space remain draggable")
            for x,y in ((100,25),(900,25),(324,32),(450,45),(720,30)):
                self.assertFalse(gdi.PtInRegion(regions[-1],x,y),"All five brand/actions/toggle/range/retry holes pass input through")
            self.assertFalse(gdi.PtInRegion(regions[-1],500,200),"Charts remain normal WebView content")
            self.assertTrue(gdi.PtInRegion(regions[-1],1,500),"Resize edges are native")
            desktop.Desktop._update_frame_region(instance)
            self.assertEqual(len(regions),1,"An unchanged region does no native positioning or painting")
            instance.form.ClientSize.Width=1100
            desktop.Desktop._update_frame_region(instance)
            for x,y in ((500,25),(100,25),(900,25),(324,32),(450,45),(720,30)):
                self.assertFalse(gdi.PtInRegion(regions[-1],x,y),"Stale controls must never be covered while the browser catches up")
            self.assertTrue(gdi.PtInRegion(regions[-1],1099,500))
            instance.frame_layout=dict(instance.frame_layout,viewport=[1100,700])
            desktop.Desktop._update_frame_region(instance)
            self.assertTrue(gdi.PtInRegion(regions[-1],500,25),"Matching browser geometry restores caption dragging")
            self.assertFalse(gdi.PtInRegion(regions[-1],450,45),"Restored geometry still passes input to nested player controls")
            instance.frame_layout=dict(instance.frame_layout,viewport=[1100,700],headerHeight=0)
            instance.form.WindowState=1
            desktop.Desktop._update_frame_region(instance)
            self.assertFalse(gdi.PtInRegion(regions[-1],500,25),"A maximized modal has no overlay hit targets")
            self.assertFalse(gdi.PtInRegion(regions[-1],1,500))
        finally:
            for region in regions:
                gdi.DeleteObject(region)


class FrameLayoutAPITests(unittest.TestCase):
    def test_layout_endpoint_authenticates_and_validates_before_posting_to_native_ui(self):
        import installer
        import spinshare_portable as app
        with tempfile.TemporaryDirectory(prefix="spinshare-frame-") as directory:
            root=Path(directory).resolve()
            game=root/"game"
            game.mkdir()
            with patch.object(installer,"default_target_directory",return_value=game):
                application=app.PortableApplication(root/"state",desktop=True)
            server=threading.Thread(target=application.serve_forever)
            server.start()
            calls=[]
            application.desktop=SimpleNamespace(choose_directory=lambda *args:None,settings_changed=lambda:None,
                update_frame_layout=lambda layout: calls.append(layout) is None)
            layout={"viewport":[1320,860],"pixelRatio":1,"headerHeight":64,"excluded":[[24,12,220,34]]}
            def request(body,key=None,origin=None):
                connection=http.client.HTTPConnection("127.0.0.1",application.port,timeout=3)
                try:
                    connection.request("POST","/v1/desktop/window/regions",json.dumps(body),
                        {"Content-Type":"application/json","Origin":origin or application.origin,
                         "X-SpinShare-Key":key or application.token})
                    response=connection.getresponse()
                    response.read()
                    return response.status
                finally:
                    connection.close()
            try:
                self.assertEqual(request(layout,key="0"*64),403)
                self.assertEqual(request(layout,origin="https://example.com"),403)
                self.assertEqual(request(dict(layout,excluded=[[0,0,1,1]]*6)),400)
                self.assertEqual(calls,[])
                self.assertEqual(request(layout),202)
                self.assertEqual(calls,[layout])
                for count in (4,5):
                    expanded=dict(layout,excluded=[[index*100,12,48,34] for index in range(count)])
                    self.assertEqual(request(expanded),202)
                    self.assertEqual(calls[-1],expanded)
            finally:
                application.manager.begin_exit()
                application.manager.work.join()
                application.close()
                server.join(3)
                self.assertFalse(server.is_alive())


if __name__ == "__main__":
    unittest.main()
