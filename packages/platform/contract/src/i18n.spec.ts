import { beforeEach, describe, expect, it } from "vitest"
import {
  camelCaseToHumanReadable,
  clearKnownAbbreviations,
  registerKnownAbbreviations,
} from "./i18n"

describe("camelCaseToHumanReadable", () => {
  beforeEach(clearKnownAbbreviations)

  it("should convert simple camelCase to human readable", () => {
    expect(camelCaseToHumanReadable("userName")).toBe("User Name")
    expect(camelCaseToHumanReadable("firstName")).toBe("First Name")
    expect(camelCaseToHumanReadable("emailAddress")).toBe("Email Address")
  })

  it("should handle single words", () => {
    expect(camelCaseToHumanReadable("user")).toBe("User")
    expect(camelCaseToHumanReadable("name")).toBe("Name")
    expect(camelCaseToHumanReadable("email")).toBe("Email")
  })

  it("should handle underscore_case", () => {
    expect(camelCaseToHumanReadable("user_name")).toBe("User Name")
    expect(camelCaseToHumanReadable("first_name")).toBe("First Name")
    expect(camelCaseToHumanReadable("email_address")).toBe("Email Address")
  })

  it("should handle kebab-case", () => {
    expect(camelCaseToHumanReadable("user-name")).toBe("User Name")
    expect(camelCaseToHumanReadable("first-name")).toBe("First Name")
    expect(camelCaseToHumanReadable("email-address")).toBe("Email Address")
  })

  it("should handle dot.case", () => {
    expect(camelCaseToHumanReadable("user.name")).toBe("User Name")
    expect(camelCaseToHumanReadable("first.name")).toBe("First Name")
    expect(camelCaseToHumanReadable("email.address")).toBe("Email Address")
  })

  it("should handle mixed separators", () => {
    expect(camelCaseToHumanReadable("userName_firstName")).toBe("User Name First Name")
    expect(camelCaseToHumanReadable("user-name.firstName")).toBe("User Name First Name")
  })

  it("should handle multiple consecutive uppercase letters", () => {
    expect(camelCaseToHumanReadable("XMLHttpRequest")).toBe("XML Http Request")
    expect(camelCaseToHumanReadable("URLPath")).toBe("URL Path")
    expect(camelCaseToHumanReadable("APIKey")).toBe("API Key")
  })

  it("should handle empty string", () => {
    expect(camelCaseToHumanReadable("")).toBe("")
  })

  it("should handle known abbreviations when registered", () => {
    registerKnownAbbreviations(["API", "URL", "XML", "HTTP", "JSON", "CSS", "HTML"])

    expect(camelCaseToHumanReadable("apiKey")).toBe("API Key")
    expect(camelCaseToHumanReadable("baseUrl")).toBe("Base URL")
    expect(camelCaseToHumanReadable("xmlHttpRequest")).toBe("XML HTTP Request")
    expect(camelCaseToHumanReadable("jsonData")).toBe("JSON Data")
    expect(camelCaseToHumanReadable("cssStyles")).toBe("CSS Styles")
    expect(camelCaseToHumanReadable("htmlContent")).toBe("HTML Content")
  })

  it("should preserve original case for unknown abbreviations", () => {
    expect(camelCaseToHumanReadable("apiKey")).toBe("Api Key")
    expect(camelCaseToHumanReadable("xmlData")).toBe("Xml Data")
    expect(camelCaseToHumanReadable("httpRequest")).toBe("Http Request")
  })
})
