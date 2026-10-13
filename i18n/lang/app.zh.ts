const translation = {
  common: {
    welcome: '欢迎使用',
    appUnavailable: '应用不可用',
    appUnkonwError: '应用不可用',
    optional: '可选',
  },
  generation: {
    tabs: {
      create: '运行一次',
      batch: '批量运行',
      saved: '已保存',
    },
    queryTitle: '客户沟通截图',
    completionResult: '分析结果',
    queryPlaceholder: '请上传客户沟通截图',
    run: '开始分析',
    copy: '复制',
    title: '客户投诉分析',
    resultTitle: '分析结果',
    noData: '上传客户沟通截图后，点击“开始分析”生成报告。',
    csvUploadTitle: '将您的 CSV 文件拖放到此处，或',
    browse: '浏览',
    csvStructureTitle: 'CSV 文件必须符合以下结构：',
    downloadTemplate: '下载模板',
    field: '',
    batchFailed: {
      info: '{{num}} 次运行失败',
      retry: '重试',
      outputPlaceholder: '无输出内容',
    },
    errorMsg: {
      empty: '上传文件的内容不能为空',
      fileStructNotMatch: '上传文件的内容与结构不匹配',
      emptyLine: '第 {{rowIndex}} 行的内容为空',
      invalidLine: '第 {{rowIndex}} 行: {{varName}}值必填',
      moreThanMaxLengthLine: '第 {{rowIndex}} 行: {{varName}}值超过最大长度 {{maxLength}}',
      atLeastOne: '上传文件的内容不能少于一条',
    },
    privacyPolicyLeft: '请阅读由该应用开发者提供的',
    privacyPolicyMiddle: '隐私政策',
    privacyPolicyRight: '。',
  },
  errorMessage: {
    valueOfVarRequired: '变量值必填',
    queryRequired: '主要文本必填',
    waitForResponse: '请等待上条信息响应完成',
    waitForImgUpload: '请等待图片上传完成',
  },
}

export default translation
