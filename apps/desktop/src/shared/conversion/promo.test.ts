import { expect, it } from "vitest";
import { stripDistributorPromo, stripDistributorPromoBlocks } from "./promo";

it("removes a distributor's advert from extracted text but keeps passages about official accounts", () => {
  expect(stripDistributorPromo("阅读材料，完成下列要求。来源：高三答案公众号")).toBe("阅读材料，完成下列要求。");
  expect(stripDistributorPromo("多住一天，仿佛就多一份勇气与力量。微信搜《高三答案公众号》获取全科")).toBe("多住一天，仿佛就多一份勇气与力量。");
  expect(stripDistributorPromo("处于集聚与辐射能力提升阶段。来源：高三答案公众号（3）①. ③")).toBe("处于集聚与辐射能力提升阶段。（3）①. ③");
  expect(stripDistributorPromo("学校开通了微信公众号，用来发布通知。")).toBe("学校开通了微信公众号，用来发布通知。");
  const blocks: any[] = [{ type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "微信搜《高三答案公众号》获取全科" }] },
    { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "正文。来源：高三答案公众号" }] }];
  expect(stripDistributorPromoBlocks(blocks)).toEqual([{ type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "正文。" }] }]);
});
