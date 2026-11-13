export const inspectionPoses = [
  {id:'neutral',name:'静止正面',parameters:{}},
  {id:'blink',name:'双眼闭合',parameters:{ParamEyeLOpen:0,ParamEyeROpen:0}},
  {id:'half-blink',name:'半闭眼',parameters:{ParamEyeLOpen:.5,ParamEyeROpen:.5}},
  {id:'wink',name:'单眼眨眼',parameters:{ParamEyeLOpen:0}},
  {id:'mouth',name:'张嘴说话',parameters:{ParamMouthOpen:1}},
  {id:'left',name:'向左转头',parameters:{ParamAngleX:-30}},
  {id:'right',name:'向右转头',parameters:{ParamAngleX:30}},
  {id:'up',name:'抬头',parameters:{ParamAngleY:30}},
  {id:'down',name:'低头',parameters:{ParamAngleY:-30}},
  {id:'diagonal',name:'组合极限',parameters:{ParamAngleX:30,ParamAngleY:-30,ParamAngleZ:15,ParamMouthOpen:1}},
  {id:'tilt',name:'歪头',parameters:{ParamAngleZ:25}},
  {id:'body',name:'身体倾斜',parameters:{ParamBodyAngleX:20,ParamBodyAngleZ:15}},
  {id:'gaze',name:'视线偏移',parameters:{ParamEyeBallX:1,ParamEyeBallY:-1}},
  {id:'hair',name:'发梢与饰品',parameters:{ParamHairFront:1,ParamHairBack:-1,ParamRibbon:1}},
]
export function inspectionValues(model,id) {
  const pose=inspectionPoses.find(p=>p.id===id);if(!pose)throw Error('检查姿态不存在')
  return Object.fromEntries(model.rig.parameters.map(p=>[p.id,Math.max(p.min,Math.min(p.max,pose.parameters[p.id]??p.default))]))
}
