export type RoboconAchievement = {
  year: number
  items: string[]
}

// Robocon 赛场记录的唯一数据源。首页参赛年数和成果页统计会随这里的内容自动更新。
export const roboconAchievements: RoboconAchievement[] = [
  {
    year: 2026,
    items: [
      '全国大学生机器人大赛 Robocon 排球赛国赛一等奖'
    ]
  },
  {
    year: 2025,
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 技能赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 排球赛国赛二等奖'
    ]
  },
  {
    year: 2024,
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 技能赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛三等奖'
    ]
  },
  {
    year: 2023,
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛三等奖'
    ]
  },
  {
    year: 2022,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: 2021,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: 2020,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: 2019,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: 2018,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛一等奖',
      '荣获“感动校园”荣誉称号'
    ]
  },
  {
    year: 2017,
    items: [
      '全国大学生机器人大赛 Robocon 国赛三等奖',
      '全国大学生机器人大赛 RoboMaster 国赛三等奖'
    ]
  },
  {
    year: 2016,
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  }
]

const recordedYears = roboconAchievements.map(({ year }) => year)

export const roboconRecordedYearCount = new Set(recordedYears).size
export const roboconAwardEntryCount = roboconAchievements.reduce(
  (total, achievement) => total + achievement.items.length,
  0
)
export const roboconYearRange = recordedYears.length
  ? `${Math.min(...recordedYears)}-${Math.max(...recordedYears)}`
  : '持续更新'
