import { describe, expect, it } from "vitest";
import { conversionFailureText, conversionServiceProblem, isTransientImportFailure } from "./failure";

describe("conversion failures", () => {
  it("tells what only the teacher can fix apart from what may pass by itself", () => {
    expect(conversionServiceProblem('402: {"message":"Insufficient Balance (request_id: c21c)","type":"insufficient_balance_error"}')).toBe("模型余额或额度不足");
    expect(conversionServiceProblem("401 Unauthorized")).toBe("模型的 Key 无法使用");
    expect(conversionServiceProblem("404 model not found")).toBe("所选模型无法使用");
    expect(conversionServiceProblem("fetch failed")).toBeUndefined();
    expect(isTransientImportFailure("fetch failed")).toBe(true);
  });
  it("does not read a page number as a status code", () => {
    expect(isTransientImportFailure("第 500 页原文格式不完整")).toBe(false);
    expect(conversionServiceProblem("第 402 页内容识别未完成，已保留原稿，可继续转换。")).toBeUndefined();
    expect(conversionFailureText("第 502 页内容识别未完成，已保留原稿，可继续转换。")).toBe("第 502 页内容识别未完成，已保留原稿，可继续转换");
  });
  it("puts what services and programs report in the teacher's words, and keeps what is already written for them", () => {
    expect(conversionFailureText('429: {"error":"too many requests"}')).toBe("连不上模型服务，进度已保存");
    expect(conversionFailureText("Cannot read properties of undefined")).toBe("中途出错，可继续转换");
    expect(conversionFailureText('400: {"error":"图片过大"}')).toBe("中途出错，可继续转换");
    expect(conversionFailureText("题目还没整理完，进度已保存")).toBe("题目还没整理完，进度已保存");
    expect(conversionFailureText(conversionFailureText("401 Unauthorized"))).toBe("模型的 Key 无法使用，进度已保存");
  });
});
