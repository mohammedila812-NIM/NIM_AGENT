import pytest
from src.perception.coord_calibrator import (
    CoordinateCalibrator,
    MonitorInfo,
    CalibratedPoint,
    CoordAnchor,
    AnchorStore,
    get_calibrator,
    list_monitors,
)
from src.tools.screen_coord_tools import (
    ListMonitorsTool,
    CalibrateCoordinatesTool,
    SaveCoordAnchorTool,
    GetCoordAnchorTool,
    ListCoordAnchorsTool,
    DeleteCoordAnchorTool,
)
from src.tools.base import ToolContext

def test_calibrator_mapping_math():
    cal = CoordinateCalibrator(monitor_index=1, force_dpi=1.0)
    # Mock monitor geometry
    cal._info = MonitorInfo(
        monitor_index=1,
        left=0,
        top=0,
        width=1920,
        height=1080,
        dpi_scale=1.0,
        physical_width=1920,
        physical_height=1080,
    )
    cal.set_viewer_size(960, 540) # Half size viewer

    pt = cal.map(480, 270, label="center")
    assert pt.screen_x == 960
    assert pt.screen_y == 540
    assert pt.label == "center"

def test_calibrator_dpi_scaling():
    cal = CoordinateCalibrator(monitor_index=1, force_dpi=1.5)
    cal._info = MonitorInfo(
        monitor_index=1,
        left=0,
        top=0,
        width=1920,
        height=1080,
        dpi_scale=1.5,
        physical_width=2880,
        physical_height=1620,
    )
    cal.set_viewer_size(1440, 810)

    # Click in middle of viewer
    pt = cal.map(720, 405)
    assert pt.screen_x == 960
    assert pt.screen_y == 540

def test_calibrator_normalized_bbox():
    cal = CoordinateCalibrator(monitor_index=1, force_dpi=1.0)
    cal._info = MonitorInfo(
        monitor_index=1,
        left=100, # with monitor offset
        top=50,
        width=1000,
        height=1000,
        dpi_scale=1.0,
        physical_width=1000,
        physical_height=1000,
    )

    # Bbox [ymin, xmin, ymax, xmax] centered at (250, 500)
    pt = cal.map_normalized_bbox([200, 400, 300, 600], coord_range=1000)
    assert pt.screen_x == 600 # 500 + 100
    assert pt.screen_y == 300 # 250 + 50

def test_anchor_store(tmp_path):
    store = AnchorStore(path=tmp_path / "anchors.json")
    anchor = CoordAnchor(name="btn_submit", screen_x=500, screen_y=300, description="Submit button")
    store.save(anchor)

    retrieved = store.get("btn_submit")
    assert retrieved is not None
    assert retrieved.screen_x == 500
    assert retrieved.screen_y == 300
    assert len(store.list()) == 1

    assert store.delete("btn_submit") is True
    assert store.get("btn_submit") is None

@pytest.mark.asyncio
async def test_screen_coord_tools_integration():
    ctx = ToolContext(task_id="test_task")
    
    list_tool = ListMonitorsTool()
    res = await list_tool.execute({}, ctx)
    assert res.success is True
    assert isinstance(res.data, list)

    cal_tool = CalibrateCoordinatesTool()
    res = await cal_tool.execute({"viewer_width": 1280, "viewer_height": 720}, ctx)
    assert res.success is True
    assert res.data["status"] == "calibrated"

    save_tool = SaveCoordAnchorTool()
    res = await save_tool.execute({"name": "test_anchor", "screen_x": 100, "screen_y": 200}, ctx)
    assert res.success is True

    get_tool = GetCoordAnchorTool()
    res = await get_tool.execute({"name": "test_anchor"}, ctx)
    assert res.success is True
    assert res.data["screen_x"] == 100

    del_tool = DeleteCoordAnchorTool()
    res = await del_tool.execute({"name": "test_anchor"}, ctx)
    assert res.success is True
