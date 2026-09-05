#!/usr/bin/env python3
"""生成桌面小组件的 RemoteViews 布局。行/格子是重复结构，用脚本产出，避免手抄错 id。"""
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res', 'layout')
HEAD = '<?xml version="1.0" encoding="utf-8"?>\n'
NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'
# 布局里的字色只是浅色默认值，渲染时 WidgetRender 会按 App 主题整体重设
COLORS = {
    '#16171A': '@color/widgetInk',
    '#8A8E97': '@color/widgetInk3',
    '#A2A6AF': '@color/widgetInk4',
    '#4F5BD5': '@color/widgetAccent',
}


def row(i, name_sp='13sp', loc=True, time=True, prefix='row'):
    rid = f'{prefix}{i}'
    parts = [
        f'    <FrameLayout android:id="@+id/{rid}" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="6dp">',
        f'        <ImageView android:id="@+id/{rid}_bg" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:src="@drawable/widget_row_bg" android:contentDescription="@null" />',
        f'        <ImageView android:id="@+id/{rid}_ring" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:src="@drawable/widget_focus" android:visibility="gone" android:contentDescription="@null" />',
        '        <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical" android:paddingTop="5dp" android:paddingBottom="5dp" android:paddingLeft="6dp" android:paddingRight="8dp">',
        f'            <ImageView android:id="@+id/{rid}_bar" android:layout_width="3dp" android:layout_height="20dp" android:scaleType="fitXY" android:src="@drawable/widget_bar" android:contentDescription="@null" />',
        '            <LinearLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:orientation="vertical" android:layout_marginLeft="7dp">',
        f'                <TextView android:id="@+id/{rid}_name" android:layout_width="match_parent" android:layout_height="wrap_content" android:maxLines="1" android:ellipsize="end" android:textSize="{name_sp}" android:textStyle="bold" android:textColor="#16171A" />',
    ]
    if loc:
        parts.append(
            f'                <TextView android:id="@+id/{rid}_loc" android:layout_width="match_parent" android:layout_height="wrap_content" android:maxLines="1" android:ellipsize="end" android:textSize="10sp" android:textColor="#8A8E97" android:layout_marginTop="1dp" />')
    parts.append('            </LinearLayout>')
    if time:
        parts.append(
            f'            <TextView android:id="@+id/{rid}_time" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="10.5sp" android:textStyle="bold" android:textColor="#8A8E97" android:layout_marginLeft="6dp" />')
    parts += ['        </LinearLayout>', '    </FrameLayout>']
    return '\n'.join(parts)


def head_block(day='w_day', wd='w_wd', sub='w_sub', day_sp='28sp'):
    return f'''    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:baselineAligned="true">
        <TextView android:id="@+id/{day}" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="{day_sp}" android:textStyle="bold" android:textColor="#16171A" />
        <TextView android:id="@+id/{wd}" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="12sp" android:textStyle="bold" android:textColor="#4F5BD5" android:layout_marginLeft="5dp" />
        <TextView android:id="@+id/{sub}" android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:gravity="right" android:textSize="10.5sp" android:textStyle="bold" android:textColor="#A2A6AF" />
    </LinearLayout>'''


EMPTY = '<TextView android:id="@+id/w_empty" android:layout_width="match_parent" android:layout_height="wrap_content" android:visibility="gone" android:textSize="12sp" android:textStyle="bold" android:textColor="#8A8E97" android:layout_marginTop="10dp" />'


def wrap(body, pad='12dp'):
    # 卡片底是一张可 setColorFilter 的 ImageView：颜色由原生按 App 主题在渲染时决定，不走资源限定符
    return f'''{HEAD}<FrameLayout {NS}
    android:id="@+id/widget_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <ImageView android:id="@+id/widget_root_bg" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:src="@drawable/widget_bg" android:contentDescription="@null" />
    <LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:padding="{pad}">
{body}
    </LinearLayout>
</FrameLayout>
'''


def write(name, text):
    for hex_, ref in COLORS.items():
        text = text.replace(f'android:textColor="{hex_}"', f'android:textColor="{ref}"')
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote', name)


# 1) 今日列表
write('widget_today.xml', wrap('\n'.join([head_block(), EMPTY] + [row(i) for i in range(2)])))

# 2) 下一节倒计时
next_body = f'''    <TextView android:id="@+id/w_label" android:layout_width="match_parent" android:layout_height="wrap_content" android:textSize="10.5sp" android:textStyle="bold" android:textColor="#8A8E97" />
    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:baselineAligned="true" android:layout_marginTop="2dp">
        <TextView android:id="@+id/w_num" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="34sp" android:textStyle="bold" android:textColor="#16171A" />
        <TextView android:id="@+id/w_unit" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="12sp" android:textStyle="bold" android:textColor="#8A8E97" android:layout_marginLeft="4dp" />
    </LinearLayout>
    <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="vertical" android:gravity="bottom">
{row(0)}
    </LinearLayout>'''
write('widget_next.xml', wrap(next_body))

# 3) 今天 / 明天
two = f'''    <LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal">
        <LinearLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:orientation="vertical">
{head_block()}
{EMPTY}
{chr(10).join(row(i) for i in range(2))}
        </LinearLayout>
        <LinearLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:orientation="vertical" android:layout_marginLeft="12dp">
            <TextView android:id="@+id/w_sub2" android:layout_width="match_parent" android:layout_height="wrap_content" android:textSize="11sp" android:textStyle="bold" android:textColor="#A2A6AF" android:paddingTop="6dp" android:paddingBottom="6dp" />
{chr(10).join(row(i, prefix='trow') for i in range(2))}
        </LinearLayout>
    </LinearLayout>'''
write('widget_two_days.xml', wrap(two))

# 4) 周视图
cols = []
for c in range(5):
    cells = []
    for r in range(3):
        cid = f'c{c}_{r}'
        cells.append(f'''            <FrameLayout android:id="@+id/{cid}" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:layout_marginTop="4dp">
                <ImageView android:id="@+id/{cid}_bg" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:src="@drawable/widget_cell_bg" android:contentDescription="@null" />
                <ImageView android:id="@+id/{cid}_ring" android:layout_width="match_parent" android:layout_height="match_parent" android:scaleType="fitXY" android:src="@drawable/widget_focus" android:visibility="gone" android:contentDescription="@null" />
                <LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:padding="5dp">
                    <TextView android:id="@+id/{cid}_name" android:layout_width="match_parent" android:layout_height="wrap_content" android:maxLines="1" android:ellipsize="end" android:textSize="10sp" android:textStyle="bold" android:textColor="#16171A" />
                    <TextView android:id="@+id/{cid}_time" android:layout_width="match_parent" android:layout_height="wrap_content" android:maxLines="1" android:textSize="9sp" android:textStyle="bold" android:textColor="#8A8E97" android:layout_marginTop="3dp" />
                    <TextView android:id="@+id/{cid}_loc" android:layout_width="match_parent" android:layout_height="wrap_content" android:maxLines="1" android:ellipsize="end" android:textSize="9sp" android:textColor="#A2A6AF" />
                </LinearLayout>
            </FrameLayout>''')
    cols.append(f'''        <LinearLayout android:layout_width="0dp" android:layout_weight="1" android:layout_height="match_parent" android:orientation="vertical" android:layout_marginLeft="{'0dp' if c == 0 else '4dp'}">
            <TextView android:id="@+id/wd{c}" android:layout_width="match_parent" android:layout_height="wrap_content" android:gravity="center" android:textSize="10.5sp" android:textStyle="bold" android:textColor="#8A8E97" />
{chr(10).join(cells)}
        </LinearLayout>''')

week_body = f'''    <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:baselineAligned="true">
        <TextView android:id="@+id/w_week" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="16sp" android:textStyle="bold" android:textColor="#16171A" />
        <TextView android:id="@+id/w_date" android:layout_width="0dp" android:layout_weight="1" android:layout_height="wrap_content" android:textSize="11sp" android:textStyle="bold" android:textColor="#A2A6AF" android:layout_marginLeft="7dp" />
    </LinearLayout>
{EMPTY}
    <LinearLayout android:id="@+id/w_grid" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:orientation="horizontal" android:layout_marginTop="8dp">
{chr(10).join(cols)}
    </LinearLayout>'''
write('widget_week.xml', wrap(week_body))

